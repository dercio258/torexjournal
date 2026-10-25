import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { AccountEntity } from '../../account/account.entity';
import { PositionEntity } from '../position.entity';
import { Mt5Service } from '../mt5.service';
import { Mt5Gateway } from '../mt5.gateway';
import { ImportMethod } from '../import-log.entity';

// telemtria 
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
    createdAt: Date;
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
    activeTerminals?: number;
    monitoredAccounts?: number[];
    isOnline: boolean;
}

@Injectable()
export class Mt5WorkerService {
    private readonly logger = new Logger(Mt5WorkerService.name);

    // In-memory queues (can be backed by Redis in cluster setup)
    private pendingTasks: Map<string, WorkerTask> = new Map();
    private credentialsStore: Map<string, TemporaryCredential> = new Map();
    private workers: Map<string, WorkerNodeState> = new Map();

    constructor(
        @InjectRepository(AccountEntity)
        private readonly accountRepo: Repository<AccountEntity>,
        @InjectRepository(PositionEntity)
        private readonly positionRepo: Repository<PositionEntity>,
        private readonly mt5Service: Mt5Service,
        private readonly mt5Gateway: Mt5Gateway,
    ) { }

    // ==========================================
    // 1. WORKER REGISTRATION & TELEMETRY
    // ==========================================
    registerWorker(workerId: string, capacity: number, systemInfo: Record<string, any>) {
        this.logger.log(`Worker conectado e registrado: [${workerId}] (Capacidade: ${capacity} contas)`);
        this.workers.set(workerId, {
            workerId,
            capacity,
            systemInfo,
            lastHeartbeat: new Date(),
            isOnline: true
        });
        return { success: true, workerId, registeredAt: new Date().toISOString() };
    }

    recordHeartbeat(heartbeat: {
        workerId: string;
        cpuPercent: number;
        memoryPercent: number;
        activeTerminals: number;
        monitoredAccounts: number[];
        timestamp?: string;
    }) {
        const worker = this.workers.get(heartbeat.workerId);
        if (worker) {
            worker.lastHeartbeat = new Date();
            worker.cpuPercent = heartbeat.cpuPercent;
            worker.memoryPercent = heartbeat.memoryPercent;
            worker.activeTerminals = heartbeat.activeTerminals;
            worker.monitoredAccounts = heartbeat.monitoredAccounts || [];
            worker.isOnline = true;
        } else {
            this.workers.set(heartbeat.workerId, {
                workerId: heartbeat.workerId,
                capacity: 10,
                systemInfo: {},
                lastHeartbeat: new Date(),
                cpuPercent: heartbeat.cpuPercent,
                memoryPercent: heartbeat.memoryPercent,
                activeTerminals: heartbeat.activeTerminals,
                monitoredAccounts: heartbeat.monitoredAccounts || [],
                isOnline: true
            });
        }
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
    createAccountTask(
        type: WorkerTaskType,
        login: string,
        server: string,
        password?: string,
        accountIdNum?: number,
        options: Record<string, any> = {}
    ): WorkerTask {
        const taskId = randomUUID();
        const numericAccId = accountIdNum || parseInt(login.replace(/\D/g, ''), 10) || Math.floor(Math.random() * 1000000);

        let credentialToken: string | undefined = undefined;
        if (password) {
            credentialToken = `token_${randomUUID().replace(/-/g, '')}`;
            this.credentialsStore.set(credentialToken, {
                login,
                server,
                password,
                expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes TTL
            });
        }

        const task: WorkerTask = {
            id: taskId,
            type,
            priority: 1,
            accountId: numericAccId,
            login,
            server,
            credentialToken,
            options,
            status: WorkerTaskStatus.RECEIVED,
            createdAt: new Date()
        };

        this.pendingTasks.set(taskId, task);
        this.logger.log(`Nova tarefa enfileirada para o worker: [${type}] para conta ${login}@${server} (TaskID: ${taskId})`);
        return task;
    }

    getPendingTasks(): WorkerTask[] {
        // Return tasks that are not yet SUCCESS or FAILED
        const tasks: WorkerTask[] = [];
        for (const task of this.pendingTasks.values()) {
            if (task.status === WorkerTaskStatus.RECEIVED || task.status === WorkerTaskStatus.IN_PROGRESS) {
                tasks.push(task);
            }
        }
        return tasks;
    }

    ackTask(taskId: string, status: WorkerTaskStatus, message?: string, details?: Record<string, any>) {
        const task = this.pendingTasks.get(taskId);
        if (!task) {
            return { success: false, message: 'Task not found' };
        }
        task.status = status;
        this.logger.log(`Tarefa [${taskId}] atualizada para status: ${status}. ${message || ''}`);

        if (status === WorkerTaskStatus.SUCCESS || status === WorkerTaskStatus.FAILED) {
            // Remove from active queue after 5 minutes to avoid memory leak
            setTimeout(() => {
                this.pendingTasks.delete(taskId);
            }, 300000);
        }
        return { success: true };
    }

    exchangeCredential(taskId: string, accountId: number, credentialToken: string) {
        const cred = this.credentialsStore.get(credentialToken);
        if (!cred) {
            this.logger.warn(`Tentativa de resgate com token expirado ou inválido: ${credentialToken}`);
            throw new NotFoundException('Credential token invalid or expired');
        }

        if (Date.now() > cred.expiresAt) {
            this.credentialsStore.delete(credentialToken);
            throw new NotFoundException('Credential token expired');
        }

        // Return credentials
        const result = {
            login: cred.login,
            server: cred.server,
            password: cred.password,
            expiresInSeconds: 60
        };

        // Burn token after successful exchange (one-time use)
        setTimeout(() => {
            this.credentialsStore.delete(credentialToken);
        }, 10000);

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
        company?: string;
        name?: string;
        tradeAllowed?: boolean;
    }) {
        const account = await this.findAccountByLoginOrId(accountInfo.login, accountInfo.accountId);
        if (!account) {
            this.logger.warn(`Conta MT5 ${accountInfo.login} não encontrada no banco de dados para sync de métricas.`);
            return { success: false, message: 'Account not found' };
        }

        account.balance = Number(accountInfo.balance) || 0;
        account.equity = Number(accountInfo.equity) || 0;
        account.margin = Number(accountInfo.margin) || 0;
        account.marginFree = Number(accountInfo.freeMargin) || 0;
        account.marginLevel = Number(accountInfo.marginLevel) || 0;
        account.leverage = Number(accountInfo.leverage) || 1;
        if (accountInfo.currency) account.currency = accountInfo.currency;
        account.isConnected = true;
        account.lastSeen = new Date();

        await this.accountRepo.save(account);

        // Broadcast to connected frontend clients via WebSocket
        try {
            this.mt5Gateway.broadcastAccountUpdate({
                balance: account.balance,
                equity: account.equity,
                margin: account.margin,
                marginFree: account.marginFree,
                marginLevel: account.marginLevel
            });
        } catch (err) {
            // Ignore socket broadcast errors
        }

        return { success: true };
    }

    async syncPositions(accountIdNum: number, login: string, positions: any[]) {
        const account = await this.findAccountByLoginOrId(login, accountIdNum);
        if (!account) {
            return { success: false, message: 'Account not found' };
        }

        // Clean existing positions for this account and re-insert current ones
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

        return { success: true, count: positions ? positions.length : 0 };
    }

    async syncTrades(accountIdNum: number, login: string, deals: any[], lastDealTicket?: number) {
        const account = await this.findAccountByLoginOrId(login, accountIdNum);
        if (!account) {
            this.logger.warn(`Conta ${login} não encontrada para inserção de trades.`);
            return { success: false, message: 'Account not found' };
        }

        if (!deals || deals.length === 0) {
            return { success: true, count: 0 };
        }

        // Filter out non-trading deals (e.g. balance deposits if needed, or process them)
        const tradingDeals = deals.filter((d) => {
            const dealType = (d.type || '').toUpperCase();
            return !dealType.includes('BALANCE') && !dealType.includes('CREDIT');
        });

        if (tradingDeals.length === 0) {
            return { success: true, count: 0 };
        }

        // Format deals into the structure that mt5Service.saveHistory expects
        const normalizedTrades = tradingDeals.map((deal) => {
            const ticket = (deal.ticket || '').toString();
            const positionId = (deal.positionId || deal.orderTicket || deal.ticket || '').toString();
            const dealTime = deal.time ? new Date(deal.time) : new Date();

            const isOut = (deal.entry || '').toUpperCase().includes('OUT');
            const profit = Number(deal.profit) || 0;
            const commission = Number(deal.commission) || 0;
            const swap = Number(deal.swap) || 0;

            return {
                ticket: ticket,
                contractId: positionId || ticket,
                symbol: deal.symbol || 'Unknown',
                type: (deal.type || '').toUpperCase().includes('BUY') ? 'BUY' : 'SELL',
                volume: Number(deal.volume) || 0,
                openPrice: Number(deal.price) || 0,
                closePrice: Number(deal.price) || 0,
                profit: profit,
                commission: commission,
                swap: swap,
                netPnl: profit + commission + swap,
                openTime: isOut ? new Date(dealTime.getTime() - 60000) : dealTime,
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

    private async findAccountByLoginOrId(login: string, accountIdNum?: number): Promise<AccountEntity | null> {
        let account = await this.accountRepo.findOne({
            where: { mt5Id: login }
        });

        if (!account && accountIdNum) {
            account = await this.accountRepo.findOne({
                where: { mt5Id: accountIdNum.toString() }
            });
        }

        return account;
    }
}
