import {
    Injectable,
    Logger,
    OnModuleInit,
    Optional,
    Inject,
    forwardRef,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Interval } from '@nestjs/schedule';
import { Repository, IsNull, Not, In } from 'typeorm';
import { AccountEntity, AccountType } from '../../account/account.entity';
import { PositionEntity } from '../position.entity';
import { NotificationEntity, NotificationType } from '../../notifications/notification.entity';
import { PushProducerService } from '../../notifications/push/push-producer.service';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { getMt5CredentialKeyring } from '../../common/security/security.config';
import { UserEntity } from '../../users/user.entity';
import {
    Mt5WorkerService,
    WorkerNodeState,
    WorkerTaskType,
} from './mt5-worker.service';

export interface BalancerWorkerInput {
    workerId: string;
    capacity: number;
    isOnline: boolean;
    isDraining?: boolean;
    cpuPercent?: number;
    memoryPercent?: number;
    memoryAvailableMb?: number;
    activeTerminals?: number;
    registrationOrder?: number;
    lastHeartbeat?: Date;
}

export type Mt5MigrationTrigger =
    | 'AUTO_FAILOVER'
    | 'MANUAL_ADMIN'
    | 'WORKER_DRAIN'
    | 'CLUSTER_REBALANCE';

export type Mt5MigrationStatus = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export interface Mt5ServerMigrationLog {
    id: string;
    telemetryId: string;
    accountMask: string;
    accountName: string | null;
    fromWorkerId: string | null;
    toWorkerId: string;
    trigger: Mt5MigrationTrigger;
    reason: string;
    status: Mt5MigrationStatus;
    leaseEpoch: number;
    taskId: string | null;
    details: string | null;
    createdAt: string;
    completedAt: string | null;
}

const DEFAULT_PAIR_STRIDE = 2;
const ZERO_BALANCE_GRACE_MS = 7 * 86_400_000; // 7 dias
const DISCONNECT_WARNING_WINDOW_MS = 24 * 3600_000; // 24 horas
const DEAD_WORKER_FAILOVER_MS = 90_000; // 90s sem heartbeat

/**
 * Converte mensagens técnicas internas de workers/terminais em copy amigável e limpa para o trader,
 * removendo termos como "servidor Windows", "VPS", "worker", "terminal64", "IPC" ou credenciais.
 */
export function humanizeClientSyncMessage(raw?: string | null, isEn = false): string {
    const msg = String(raw || '').trim();
    if (!msg) {
        return isEn
            ? 'Synchronizing your trading account safely...'
            : 'A sincronizar a sua conta de trading em segurança...';
    }
    const lower = msg.toLowerCase();

    if (
        lower.includes('authorization failed') ||
        lower.includes('(-6') ||
        lower.includes('login failed') ||
        lower.includes('senha') ||
        lower.includes('password') ||
        lower.includes('autenticar')
    ) {
        return isEn
            ? 'Could not authenticate with your broker. Please verify account credentials and server name.'
            : 'Não foi possível autenticar na corretora. Verifique o número da conta, a senha e o servidor.';
    }

    if (
        lower.includes('resource_exhaustion') ||
        lower.includes('esgotamento') ||
        lower.includes('memória consumida') ||
        lower.includes('worker rss') ||
        lower.includes('anti-loop')
    ) {
        return isEn
            ? 'Sync nodes are balancing traffic right now. Your account will resume automatically shortly.'
            : 'Os nossos motores estão a equilibrar a carga neste momento. A sua conta será retomada automaticamente em instantes.';
    }

    if (
        lower.includes('reivindicou') ||
        lower.includes('worker windows') ||
        lower.includes('servidor windows') ||
        lower.includes('vps')
    ) {
        return isEn
            ? 'Updating account metrics and recent trade history...'
            : 'A atualizar o saldo e o histórico recente da sua conta...';
    }

    if (
        lower.includes('terminal64') ||
        lower.includes('ipc') ||
        lower.includes('pipe') ||
        lower.includes('stale_worker_lease')
    ) {
        return isEn
            ? 'Re-establishing broker connection stream. Please wait a moment...'
            : 'A restabelecer ligação estável com a corretora. Aguarde alguns instantes...';
    }

    if (lower.includes('credential token') || lower.includes('credentialtoken')) {
        return isEn
            ? 'Connection session expired before completion. Please try reconnecting.'
            : 'A sessão de ligação expirou antes de concluir. Tente ligar novamente.';
    }

    // Remove qualquer sobra acidental de termos técnicos internos
    return msg
        .replace(/\b(servidor\s+windows|windows\s+server|worker\s+windows|vps|worker|terminal64\.exe)\b/gi, 'sistema de sincronização')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

@Injectable()
export class Mt5ClusterBalancerService implements OnModuleInit {
    private readonly logger = new Logger(Mt5ClusterBalancerService.name);
    private readonly pendingEvictionsByWorker = new Map<string, Set<string>>();
    private readonly drainingWorkers = new Set<string>();
    private readonly migrationLogs: Mt5ServerMigrationLog[] = [];
    private readonly missingPassAlertedAt = new Map<string, number>();
    private readonly serviceStartedAt = Date.now();
    private lifecycleRunning = false;

    constructor(
        @InjectRepository(AccountEntity)
        private readonly accountRepo: Repository<AccountEntity>,
        @InjectRepository(PositionEntity)
        private readonly positionRepo: Repository<PositionEntity>,
        @InjectRepository(NotificationEntity)
        private readonly notificationRepo: Repository<NotificationEntity>,
        @Optional()
        @Inject(forwardRef(() => Mt5WorkerService))
        private readonly mt5WorkerService?: Mt5WorkerService,
        @Optional()
        private readonly pushProducer?: PushProducerService,
        @Optional()
        private readonly configService?: ConfigService,
        @Optional()
        @InjectRepository(UserEntity)
        private readonly userRepo?: Repository<UserEntity>,
    ) {}

    async onModuleInit() {
        try {
            await this.accountRepo.manager?.query?.(`
                ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "assigned_worker_id" varchar(80) NULL;
                ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "mt5_lease_epoch" integer DEFAULT 1;
                ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "mt5_sync_tier" varchar(24) DEFAULT 'HOT';
                ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "mt5_encrypted_pass" text NULL;
                ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "zero_balance_since" timestamp NULL;
                ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "inactivity_warned_at" timestamp NULL;
                ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "inactivity_disconnect_at" timestamp NULL;
                CREATE INDEX IF NOT EXISTS "idx_accounts_assigned_worker" ON "accounts" ("assigned_worker_id");
                CREATE TABLE IF NOT EXISTS "mt5_server_migrations" (
                    "id" varchar(64) PRIMARY KEY,
                    "telemetry_id" varchar(16) NOT NULL,
                    "account_mask" varchar(32) NOT NULL,
                    "account_name" varchar(120) NULL,
                    "from_worker_id" varchar(80) NULL,
                    "to_worker_id" varchar(80) NOT NULL,
                    "trigger" varchar(32) NOT NULL,
                    "reason" text NOT NULL,
                    "status" varchar(24) NOT NULL DEFAULT 'IN_PROGRESS',
                    "lease_epoch" integer NOT NULL DEFAULT 1,
                    "task_id" varchar(64) NULL,
                    "details" text NULL,
                    "created_at" timestamp NOT NULL DEFAULT now(),
                    "completed_at" timestamp NULL
                );
                CREATE INDEX IF NOT EXISTS "idx_mt5_server_migrations_created" ON "mt5_server_migrations" ("created_at" DESC);
            `);
            const savedRows: any[] = await this.accountRepo.manager
                ?.query?.(
                    `SELECT id, telemetry_id, account_mask, account_name, from_worker_id, to_worker_id, trigger, reason, status, lease_epoch, task_id, details, created_at, completed_at
                     FROM "mt5_server_migrations"
                     ORDER BY created_at DESC
                     LIMIT 60`,
                )
                .catch(() => []);
            if (Array.isArray(savedRows) && savedRows.length > 0) {
                for (const r of savedRows) {
                    this.migrationLogs.push({
                        id: String(r.id),
                        telemetryId: String(r.telemetry_id),
                        accountMask: String(r.account_mask),
                        accountName: r.account_name ? String(r.account_name) : null,
                        fromWorkerId: r.from_worker_id ? String(r.from_worker_id) : null,
                        toWorkerId: String(r.to_worker_id),
                        trigger: r.trigger as Mt5MigrationTrigger,
                        reason: String(r.reason || ''),
                        status: (r.status || 'COMPLETED') as Mt5MigrationStatus,
                        leaseEpoch: Number(r.lease_epoch || 1),
                        taskId: r.task_id ? String(r.task_id) : null,
                        details: r.details ? String(r.details) : null,
                        createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
                        completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
                    });
                }
            }
        } catch (err: any) {
            this.logger.warn(`Cluster columns check warning: ${err?.message || err}`);
        }
    }

    getPairStride(): number {
        const raw = Number(
            this.configService?.get('MT5_LB_STRIDE') ??
                process.env.MT5_LB_STRIDE ??
                DEFAULT_PAIR_STRIDE,
        );
        return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_PAIR_STRIDE;
    }

    isWorkerDraining(workerId: string): boolean {
        return this.drainingWorkers.has(workerId);
    }

    setWorkerDrainingFlag(workerId: string, drain: boolean) {
        if (drain) {
            this.drainingWorkers.add(workerId);
        } else {
            this.drainingWorkers.delete(workerId);
        }
    }

    queueEviction(workerId: string, login: string) {
        const w = String(workerId || '').trim();
        const l = String(login || '').trim();
        if (!w || !l) return;
        const set = this.pendingEvictionsByWorker.get(w) || new Set<string>();
        set.add(l);
        this.pendingEvictionsByWorker.set(w, set);
    }

    consumeEvictionsForWorker(workerId: string): string[] {
        const w = String(workerId || '').trim();
        if (!w) return [];
        const set = this.pendingEvictionsByWorker.get(w);
        if (!set || set.size === 0) return [];
        const out = Array.from(set);
        this.pendingEvictionsByWorker.delete(w);
        return out;
    }

    /**
     * Seleciona o próximo Worker Windows seguindo o algoritmo Pair-Stride (padrão K=2):
     * - Contas 1 e 2 -> Worker 1
     * - Contas 3 e 4 -> Worker 2
     * - Contas 5 e 6 -> Worker 1 (ou Worker 3 se existir, voltando em ciclos de 2)
     * Com guarda de saúde (CPU < 90%, RAM < 88%, RAM livre >= 200 MB) e exclusão de nós em DRAIN.
     */
    selectWorkerForAccount(
        workers: BalancerWorkerInput[],
        assignedCounts: Record<string, number>,
        options?: { preferredWorkerId?: string | null; excludeWorkerIds?: string[]; stride?: number },
    ): BalancerWorkerInput | null {
        const stride = Math.max(1, options?.stride ?? this.getPairStride());
        const excluded = new Set(options?.excludeWorkerIds || []);

        const isHealthyAndEligible = (w: BalancerWorkerInput) => {
            if (!w.workerId || excluded.has(w.workerId)) return false;
            if (!w.isOnline) return false;
            if (w.isDraining || this.drainingWorkers.has(w.workerId)) return false;
            const load = assignedCounts[w.workerId] ?? 0;
            const cap = Number(w.capacity || 0) > 0 ? Number(w.capacity) : 100;
            if (load >= cap) return false;
            if ((w.cpuPercent ?? 0) >= 90) return false;
            if ((w.memoryPercent ?? 0) >= 88) return false;
            if (w.memoryAvailableMb !== undefined && w.memoryAvailableMb < 200) return false;
            return true;
        };

        const eligible = workers.filter(isHealthyAndEligible);
        if (eligible.length === 0) return null;

        // Mantém afinidade sticky se a conta já está vinculada a um worker saudável e elegível
        if (options?.preferredWorkerId) {
            const sticky = eligible.find((w) => w.workerId === options.preferredWorkerId);
            if (sticky) return sticky;
        }

        const ordered = [...eligible].sort((a, b) => {
            const countA = assignedCounts[a.workerId] ?? 0;
            const countB = assignedCounts[b.workerId] ?? 0;

            const bucketA = Math.floor(countA / stride);
            const bucketB = Math.floor(countB / stride);
            if (bucketA !== bucketB) return bucketA - bucketB;

            // Completa primeiro o par incompleto atual (ex.: worker com 1/2 recebe a 2ª antes de saltar)
            const incompleteA = countA % stride > 0 ? 0 : 1;
            const incompleteB = countB % stride > 0 ? 0 : 1;
            if (incompleteA !== incompleteB) return incompleteA - incompleteB;

            const regA = a.registrationOrder ?? Number.MAX_SAFE_INTEGER;
            const regB = b.registrationOrder ?? Number.MAX_SAFE_INTEGER;
            if (regA !== regB) return regA - regB;

            return a.workerId.localeCompare(b.workerId, undefined, { numeric: true });
        });

        return ordered[0] || null;
    }

    async computeAssignedCountsByWorker(): Promise<Record<string, number>> {
        const counts: Record<string, number> = {};
        try {
            const rows = await this.accountRepo.find({
                where: {
                    isArchived: false,
                    assignedWorkerId: Not(IsNull()),
                },
                select: ['id', 'assignedWorkerId', 'isConnected'],
            });
            for (const row of rows) {
                if (row.assignedWorkerId && row.isConnected !== false) {
                    counts[row.assignedWorkerId] = (counts[row.assignedWorkerId] || 0) + 1;
                }
            }
        } catch {
            // fallback seguro se mock de teste não suportar Not(IsNull())
        }
        return counts;
    }

    async assignWorkerForAccount(
        accountId: string,
        workersSnapshot?: BalancerWorkerInput[],
    ): Promise<{ workerId: string | null; leaseEpoch: number }> {
        const workers = workersSnapshot || this.getWorkerInputsFromService();
        const account = await this.accountRepo.findOne({ where: { id: accountId } });
        if (!account) return { workerId: null, leaseEpoch: 1 };

        const assignedCounts = await this.computeAssignedCountsByWorker();
        const chosen = this.selectWorkerForAccount(workers, assignedCounts, {
            preferredWorkerId: account.assignedWorkerId,
        });

        if (!chosen) {
            return {
                workerId: account.assignedWorkerId || null,
                leaseEpoch: Number(account.mt5LeaseEpoch || 1),
            };
        }

        const changedWorker = account.assignedWorkerId && account.assignedWorkerId !== chosen.workerId;
        const nextEpoch = changedWorker
            ? Number(account.mt5LeaseEpoch || 1) + 1
            : Number(account.mt5LeaseEpoch || 1);

        if (changedWorker && account.assignedWorkerId && account.mt5Id) {
            this.queueEviction(account.assignedWorkerId, account.mt5Id);
        }

        account.assignedWorkerId = chosen.workerId;
        account.mt5LeaseEpoch = nextEpoch;
        if (!account.mt5SyncTier || account.mt5SyncTier === 'COLD') {
            account.mt5SyncTier = 'HOT';
        }
        await this.accountRepo.save(account);

        return { workerId: chosen.workerId, leaseEpoch: nextEpoch };
    }

    private getWorkerInputsFromService(): BalancerWorkerInput[] {
        if (!this.mt5WorkerService) return [];
        const rawList = this.mt5WorkerService.getWorkerStatus(undefined, true) as WorkerNodeState[];
        if (!Array.isArray(rawList)) return [];
        return rawList.map((w, idx) => ({
            workerId: w.workerId,
            capacity: w.capacity || 100,
            isOnline: Boolean(w.isOnline),
            isDraining: Boolean(w.isDraining || this.drainingWorkers.has(w.workerId)),
            cpuPercent: w.cpuPercent,
            memoryPercent: w.memoryPercent,
            memoryAvailableMb: w.memoryAvailableMb,
            activeTerminals: w.activeTerminals,
            registrationOrder: w.registrationOrder ?? idx,
            lastHeartbeat: w.lastHeartbeat,
        }));
    }

    @Interval(30_000)
    async runClusterWatchdogTick() {
        if (process.env.MT5_DEDICATED_SERVER === 'true') return;
        if (this.lifecycleRunning) return;
        this.lifecycleRunning = true;
        try {
            await this.evaluateDeadWorkerFailover();
            await this.evaluateZeroBalanceAccounts();
        } catch (err: any) {
            this.logger.warn(`Cluster watchdog warning: ${err?.message || err}`);
        } finally {
            this.lifecycleRunning = false;
        }
    }

    private async appendAdminMigrationLog(entry: Mt5ServerMigrationLog): Promise<void> {
        this.migrationLogs.unshift(entry);
        if (this.migrationLogs.length > 100) {
            this.migrationLogs.length = 100;
        }
        try {
            await this.accountRepo.manager?.query?.(
                `INSERT INTO "mt5_server_migrations" (
                    id, telemetry_id, account_mask, account_name, from_worker_id, to_worker_id,
                    trigger, reason, status, lease_epoch, task_id, details, created_at, completed_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                ON CONFLICT (id) DO NOTHING`,
                [
                    entry.id,
                    entry.telemetryId,
                    entry.accountMask,
                    entry.accountName,
                    entry.fromWorkerId,
                    entry.toWorkerId,
                    entry.trigger,
                    entry.reason,
                    entry.status,
                    entry.leaseEpoch,
                    entry.taskId,
                    entry.details,
                    new Date(entry.createdAt),
                    entry.completedAt ? new Date(entry.completedAt) : null,
                ],
            );
        } catch {
            // Não bloqueia operação se tabela ainda não existir em ambiente de teste
        }
    }

    async recordMigrationTaskOutcome(
        migrationId: string,
        status: 'COMPLETED' | 'FAILED',
        details?: string | null,
    ): Promise<void> {
        const cleanId = String(migrationId || '').trim();
        if (!cleanId) return;
        const completedAt = new Date().toISOString();
        const sanitizedDetails = details
            ? String(details)
                  .replace(/[A-Za-z]:\\[^\s'"]+|\/(?:home|root|var|tmp|Users)\/[^\s'"]+/g, '[path]')
                  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
                  .slice(0, 220)
            : null;

        const existing = this.migrationLogs.find((m) => m.id === cleanId);
        if (existing) {
            existing.status = status;
            existing.details = sanitizedDetails || existing.details;
            existing.completedAt = completedAt;
        }
        try {
            await this.accountRepo.manager?.query?.(
                `UPDATE "mt5_server_migrations"
                 SET status = $1, details = COALESCE($2, details), completed_at = $3
                 WHERE id = $4`,
                [status, sanitizedDetails, new Date(completedAt), cleanId],
            );
        } catch {
            // ignore in tests
        }
        this.logger.log(
            `[ADMIN-MIGRATION] Migração [${cleanId}] finalizada com status=${status}${sanitizedDetails ? ` | ${sanitizedDetails}` : ''}`,
        );
    }

    private async resolveAccountOwnerName(userId?: string | null): Promise<string | null> {
        if (!userId || !this.userRepo) return null;
        try {
            const u = await this.userRepo.findOne({
                where: { id: userId },
                select: ['id', 'name', 'username'],
            });
            return String(u?.name || u?.username || '').trim() || null;
        } catch {
            return null;
        }
    }

    /**
     * Migra silenciosamente uma conta MT5 de um servidor worker para outro servidor online:
     * - Mantém `isConnected = true` (zero queda visível para o trader)
     * - Descriptografa credenciais armazenadas e faz login automático no novo servidor com reconciliação completa
     * - Emite eviction + fencing (`leaseEpoch + 1`) contra o servidor antigo
     * - Registra o evento exclusivamente no log administrativo de migrações (`mt5_server_migrations`)
     */
    private async executeSilentAccountMigration(
        acc: AccountEntity,
        targetWorkerId: string,
        trigger: Mt5MigrationTrigger,
        reason: string,
        options?: { priority?: number; requireStoredPassword?: boolean },
    ): Promise<{
        migrated: boolean;
        migrationLog: Mt5ServerMigrationLog | null;
        taskId: string | null;
        failureReason?: 'INVALID_LOGIN' | 'PASSWORD_NOT_STORED' | 'PASSWORD_DECRYPT_FAILED';
    }> {
        const cleanLogin = String(acc.mt5Id || '').trim();
        if (!/^\d{4,16}$/.test(cleanLogin)) {
            return { migrated: false, migrationLog: null, taskId: null, failureReason: 'INVALID_LOGIN' };
        }

        const oldWorker = acc.assignedWorkerId || null;
        const telemetryId = this.computeTelemetryId(acc.id);
        const accountMask = this.formatAccountMask(cleanLogin);
        const ownerName = await this.resolveAccountOwnerName(acc.userId);
        const liveTel = this.mt5WorkerService?.getAnonymizedAccountTelemetry?.(
            cleanLogin,
            Boolean(acc.isConnected),
        );
        const accountName = this.resolveSafeDisplayName(
            acc.name,
            cleanLogin,
            ownerName,
            liveTel?.accountHolderName || null,
        );

        const passCheck = await this.inspectStoredPassword(acc.id);
        const pass = passCheck.password;
        if (!pass && options?.requireStoredPassword !== false) {
            const failureCode =
                passCheck.status === 'DECRYPT_FAILED'
                    ? 'PASSWORD_DECRYPT_FAILED'
                    : 'PASSWORD_NOT_STORED';
            const failureDetails =
                failureCode === 'PASSWORD_DECRYPT_FAILED'
                    ? 'Falha ao descriptografar a senha MT5 no cofre do backend (chave de criptografia divergente).'
                    : 'Senha MT5 não armazenada no cofre do backend para migração entre servidores.';
            const nowMs = Date.now();
            const lastAlert = this.missingPassAlertedAt.get(acc.id) || 0;
            if (trigger === 'MANUAL_ADMIN' || nowMs - lastAlert >= 10 * 60_000) {
                this.missingPassAlertedAt.set(acc.id, nowMs);
                const failEntry: Mt5ServerMigrationLog = {
                    id: randomUUID(),
                    telemetryId,
                    accountMask,
                    accountName,
                    fromWorkerId: oldWorker,
                    toWorkerId: targetWorkerId,
                    trigger,
                    reason,
                    status: 'FAILED',
                    leaseEpoch: Number(acc.mt5LeaseEpoch || 1),
                    taskId: null,
                    details: failureDetails,
                    createdAt: new Date(nowMs).toISOString(),
                    completedAt: new Date(nowMs).toISOString(),
                };
                await this.appendAdminMigrationLog(failEntry);
            }
            return {
                migrated: false,
                migrationLog: null,
                taskId: null,
                failureReason: failureCode,
            };
        }

        const nextEpoch = Number(acc.mt5LeaseEpoch || 1) + 1;
        acc.assignedWorkerId = targetWorkerId;
        acc.mt5LeaseEpoch = nextEpoch;
        acc.mt5SyncTier = 'HOT';
        acc.inactivityWarnedAt = null;
        acc.inactivityDisconnectAt = null;
        // Mantém a conexão ativa aos olhos do utilizador durante toda a troca de servidor
        if (acc.isConnected !== true && trigger !== 'MANUAL_ADMIN') {
            acc.isConnected = true;
        }
        await this.accountRepo.save(acc);

        if (oldWorker && oldWorker !== targetWorkerId) {
            this.queueEviction(oldWorker, cleanLogin);
        }

        const migrationId = randomUUID();
        let taskId: string | null = null;
        if (this.mt5WorkerService) {
            const cleanServer = this.mt5WorkerService.normalizeBrokerServer(String(acc.broker || '').trim());
            const numId = this.mt5WorkerService.deriveNumericAccountId(cleanLogin);
            const task = this.mt5WorkerService.createAccountTask(
                WorkerTaskType.START_ACCOUNT,
                cleanLogin,
                cleanServer,
                pass || undefined,
                numId,
                {
                    userId: acc.userId,
                    accountUuid: acc.id,
                    targetWorkerId,
                    leaseEpoch: nextEpoch,
                    priority: options?.priority ?? 1,
                    silentMigration: true,
                    migrationId,
                    fromWorkerId: oldWorker,
                    toWorkerId: targetWorkerId,
                    migrationTrigger: trigger,
                },
            );
            taskId = task.id;
        }

        const logEntry: Mt5ServerMigrationLog = {
            id: migrationId,
            telemetryId,
            accountMask,
            accountName,
            fromWorkerId: oldWorker,
            toWorkerId: targetWorkerId,
            trigger,
            reason,
            status: 'IN_PROGRESS',
            leaseEpoch: nextEpoch,
            taskId,
            details: `Migração silenciosa iniciada (${oldWorker || 'sem-servidor'} → ${targetWorkerId}, epoch=${nextEpoch}). Conexão preservada para o cliente.`,
            createdAt: new Date().toISOString(),
            completedAt: null,
        };
        await this.appendAdminMigrationLog(logEntry);

        this.logger.warn(
            `[CLUSTER-MIGRATION][${trigger}] Conta ${accountMask} (#${telemetryId}) migrada silenciosamente: ${oldWorker || 'NONE'} -> ${targetWorkerId} (epoch=${nextEpoch}, task=${taskId || 'N/A'}).`,
        );

        return { migrated: true, migrationLog: logEntry, taskId };
    }

    /**
     * Detecta VPS/workers offline há mais de 90s (ou workers órfãos que nunca enviaram heartbeat após restart)
     * e migra automaticamente todas as contas conectadas para outros servidores saudáveis online,
     * mantendo a conexão ativa de forma 100% transparente para o utilizador (log apenas no Admin).
     */
    async evaluateDeadWorkerFailover(nowMs: number = Date.now()): Promise<{ migrated: number }> {
        const workers = this.getWorkerInputsFromService();
        if (workers.length === 0) return { migrated: 0 };

        const healthyNodes = workers.filter(
            (w) => w.isOnline && !w.isDraining && !this.drainingWorkers.has(w.workerId),
        );
        if (healthyNodes.length === 0) return { migrated: 0 };

        const onlineWorkerIds = new Set(workers.filter((w) => w.isOnline).map((w) => w.workerId));
        const deadWorkerIds = new Set(
            workers
                .filter((w) => {
                    const hbMs = w.lastHeartbeat ? new Date(w.lastHeartbeat).getTime() : 0;
                    return !w.isOnline && hbMs > 0 && nowMs - hbMs > DEAD_WORKER_FAILOVER_MS;
                })
                .map((w) => w.workerId),
        );

        const pastBootGrace = nowMs - this.serviceStartedAt > DEAD_WORKER_FAILOVER_MS;

        let migrated = 0;
        const accounts = await this.accountRepo.find({
            where: { isArchived: false, isConnected: true },
        });
        const assignedCounts = await this.computeAssignedCountsByWorker();

        for (const acc of accounts) {
            if (!acc.mt5Id) continue;
            const oldWorker = acc.assignedWorkerId || null;

            const isRegisteredDead = Boolean(oldWorker && deadWorkerIds.has(oldWorker));
            const isMissingAfterBootGrace = Boolean(
                pastBootGrace && oldWorker && !onlineWorkerIds.has(oldWorker),
            );
            const isUnassigned = Boolean(pastBootGrace && !oldWorker);

            if (!isRegisteredDead && !isMissingAfterBootGrace && !isUnassigned) continue;

            const target = this.selectWorkerForAccount(workers, assignedCounts, {
                excludeWorkerIds: oldWorker ? [oldWorker] : [],
            });
            if (!target) break;

            const reason = isRegisteredDead
                ? `Servidor ${oldWorker} ficou offline (>90s sem heartbeat). Failover automático acionado.`
                : isMissingAfterBootGrace
                  ? `Servidor ${oldWorker} indisponível no cluster. Failover automático acionado.`
                  : 'Conta ativa sem servidor atribuído. Alocação automática acionada.';

            const result = await this.executeSilentAccountMigration(
                acc,
                target.workerId,
                'AUTO_FAILOVER',
                reason,
                { priority: 1, requireStoredPassword: true },
            );

            if (result.migrated) {
                if (oldWorker) {
                    assignedCounts[oldWorker] = Math.max(0, (assignedCounts[oldWorker] || 1) - 1);
                }
                assignedCounts[target.workerId] = (assignedCounts[target.workerId] || 0) + 1;
                migrated++;
            }
        }

        return { migrated };
    }

    /**
     * Regra de ciclo de vida de contas sem saldo há 7 dias:
     * 1. Aos 7 dias sem saldo/equity (e 0 posições abertas): emite aviso amigável + Web Push de pausa em 24h.
     * 2. Após 24h do aviso (se continuar zerada e o utilizador não clicou em "Manter Ativa"): pausa sincronização e liberta RAM.
     */
    async evaluateZeroBalanceAccounts(
        nowMs: number = Date.now(),
    ): Promise<{ warned: number; disconnected: number }> {
        const accounts = await this.accountRepo.find({
            where: { isArchived: false, isConnected: true },
        });
        if (!accounts || accounts.length === 0) {
            return { warned: 0, disconnected: 0 };
        }

        let warned = 0;
        let disconnected = 0;

        for (const acc of accounts) {
            if (!acc.mt5Id || acc.type === AccountType.CUSTOM) continue;

            const balance = Number(acc.balance || 0);
            const equity = Number(acc.equity || 0);

            if (balance > 0 || equity > 0) {
                if (acc.zeroBalanceSince || acc.inactivityWarnedAt || acc.inactivityDisconnectAt) {
                    acc.zeroBalanceSince = null;
                    acc.inactivityWarnedAt = null;
                    acc.inactivityDisconnectAt = null;
                    await this.accountRepo.save(acc);
                }
                continue;
            }

            const openPositions = await this.positionRepo.count({
                where: { accountId: acc.id },
            });
            if (openPositions > 0) continue;

            if (!acc.zeroBalanceSince) {
                acc.zeroBalanceSince = new Date(nowMs);
                await this.accountRepo.save(acc);
                continue;
            }

            const idleMs = nowMs - new Date(acc.zeroBalanceSince).getTime();

            // Passo A: Aos 7 dias sem movimento -> agenda pausa para +24h e avisa o trader com copy amigável
            if (idleMs >= ZERO_BALANCE_GRACE_MS && !acc.inactivityWarnedAt) {
                const warnDate = new Date(nowMs);
                const disconnectDate = new Date(nowMs + DISCONNECT_WARNING_WINDOW_MS);
                acc.inactivityWarnedAt = warnDate;
                acc.inactivityDisconnectAt = disconnectDate;
                await this.accountRepo.save(acc);

                const locale = await this.resolveUserLocale(acc.userId);
                const isEn = locale === 'en';
                const accName = acc.name || 'Trading';

                try {
                    const notif = this.notificationRepo.create({
                        accountId: acc.id,
                        type: NotificationType.SYSTEM,
                        title: isEn
                            ? 'Account sync will pause in 24h'
                            : 'Sincronização será pausada em 24h',
                        message: isEn
                            ? `Account "${accName}" has had no balance activity for 7 days. Tap "Keep Sync Active" on your dashboard if you wish to keep it connected.`
                            : `A conta "${accName}" está sem saldo movimentado há 7 dias. Clique em "Manter Sincronização Ativa" no painel inicial se desejar mantê-la conectada.`,
                    });
                    await this.notificationRepo.save(notif);
                } catch {
                    // ignore notification failure
                }

                if (acc.userId && this.pushProducer) {
                    await this.pushProducer
                        .sendIdleAccountShutdownWarning(acc.userId, accName, locale)
                        .catch(() => {});
                }
                warned++;
                continue;
            }

            // Passo B: 24h após aviso -> desconecta suavemente e envia STOP_ACCOUNT ao worker dono
            if (
                acc.inactivityDisconnectAt &&
                nowMs >= new Date(acc.inactivityDisconnectAt).getTime()
            ) {
                const targetWorker = acc.assignedWorkerId || undefined;
                if (this.mt5WorkerService && acc.mt5Id) {
                    const numId = this.mt5WorkerService.deriveNumericAccountId(acc.mt5Id);
                    this.mt5WorkerService.createAccountTask(
                        WorkerTaskType.STOP_ACCOUNT,
                        acc.mt5Id,
                        acc.broker || '',
                        undefined,
                        numId,
                        {
                            userId: acc.userId,
                            accountUuid: acc.id,
                            targetWorkerId: targetWorker,
                            priority: 3,
                        },
                    );
                }

                acc.isConnected = false;
                acc.mt5SyncTier = 'COLD';
                acc.assignedWorkerId = null;
                acc.inactivityDisconnectAt = null;
                await this.accountRepo.save(acc);

                const locale = await this.resolveUserLocale(acc.userId);
                const isEn = locale === 'en';
                const accName = acc.name || 'Trading';
                try {
                    const notif = this.notificationRepo.create({
                        accountId: acc.id,
                        type: NotificationType.SYSTEM,
                        title: isEn
                            ? 'Auto-sync paused for inactivity'
                            : 'Sincronização pausada por inatividade',
                        message: isEn
                            ? `Auto-sync for "${accName}" was paused after 7 days with zero balance and the 24h notice. You can reconnect it anytime.`
                            : `A sincronização automática da conta "${accName}" foi pausada após 7 dias sem saldo e 24h de aviso prévio. Pode reativá-la a qualquer momento.`,
                    });
                    await this.notificationRepo.save(notif);
                } catch {
                    // ignore notification failure
                }

                disconnected++;
            }
        }

        return { warned, disconnected };
    }

    /**
     * Botão no Dashboard ("Manter Sincronização Ativa"): estende o prazo por mais 7 dias
     * e limpa o contador regressivo de 24h.
     */
    async keepAccountAlive(userId: string, accountId: string) {
        const account = await this.accountRepo.findOne({
            where: { id: accountId, userId, isArchived: false },
        });
        if (!account) {
            throw new NotFoundException('Conta não encontrada para este utilizador.');
        }

        account.zeroBalanceSince = new Date();
        account.inactivityWarnedAt = null;
        account.inactivityDisconnectAt = null;
        if (account.isConnected && (!account.mt5SyncTier || account.mt5SyncTier === 'COLD')) {
            account.mt5SyncTier = 'WARM';
        }
        await this.accountRepo.save(account);

        const locale = await this.resolveUserLocale(userId);
        return {
            success: true,
            accountId: account.id,
            message:
                locale === 'en'
                    ? 'Auto-sync will remain active for your account.'
                    : 'Sincronização mantida ativa! A sua conta continuará conectada normalmente.',
        };
    }

    async setWorkerDrain(workerId: string, drain: boolean) {
        this.setWorkerDrainingFlag(workerId, drain);
        let migrated = 0;
        let failed = 0;
        const details: string[] = [];

        if (drain) {
            const batch = await this.migrateWorkerAccountsInternal(
                workerId,
                undefined,
                'WORKER_DRAIN',
                `Servidor ${workerId} colocado em modo Drain pelo administrador.`,
                2,
            );
            migrated = batch.migrated;
            failed = batch.failed;
            details.push(...batch.details);
        }

        const message = drain
            ? migrated > 0 || failed > 0
                ? `Worker ${workerId} em modo Drain: ${migrated} conta(s) migrada(s), ${failed} impedida(s).${details.length > 0 ? ` ${details[0]}` : ''}`
                : `Worker ${workerId} colocado em modo Drain (nenhuma conta ativa para migrar).`
            : `Worker ${workerId} reativado no balanceador.`;

        return { success: true, workerId, draining: drain, migrated, failed, details, message };
    }

    private async migrateWorkerAccountsInternal(
        fromWorkerId: string,
        explicitTargetWorkerId: string | undefined,
        trigger: Mt5MigrationTrigger,
        reason: string,
        priority = 1,
    ) {
        const cleanFrom = String(fromWorkerId || '').trim();
        const workers = this.getWorkerInputsFromService();
        const accounts = await this.accountRepo.find({
            where: { assignedWorkerId: cleanFrom, isArchived: false, mt5Id: Not(IsNull()) },
        });
        const assignedCounts = await this.computeAssignedCountsByWorker();
        const details: string[] = [];
        let migrated = 0;
        let failed = 0;
        let skippedNoCredentials = 0;
        let skippedNoTarget = 0;

        for (const acc of accounts) {
            if (!acc.mt5Id) continue;
            let target: BalancerWorkerInput | null = null;
            if (explicitTargetWorkerId) {
                target =
                    workers.find(
                        (w) =>
                            w.workerId === explicitTargetWorkerId &&
                            w.isOnline &&
                            !w.isDraining &&
                            !this.drainingWorkers.has(w.workerId),
                    ) || null;
            } else {
                target = this.selectWorkerForAccount(workers, assignedCounts, {
                    excludeWorkerIds: [cleanFrom],
                });
            }

            if (!target) {
                skippedNoTarget++;
                failed++;
                details.push(
                    `Sem servidor destino online saudável disponível para ${this.formatAccountMask(acc.mt5Id)}.`,
                );
                continue;
            }

            const result = await this.executeSilentAccountMigration(
                acc,
                target.workerId,
                trigger,
                reason,
                { priority, requireStoredPassword: true },
            );
            if (result.migrated) {
                assignedCounts[cleanFrom] = Math.max(0, (assignedCounts[cleanFrom] || 1) - 1);
                assignedCounts[target.workerId] = (assignedCounts[target.workerId] || 0) + 1;
                migrated++;
            } else {
                failed++;
                if (
                    result.failureReason === 'PASSWORD_NOT_STORED' ||
                    result.failureReason === 'PASSWORD_DECRYPT_FAILED'
                ) {
                    skippedNoCredentials++;
                }
                const mask = this.formatAccountMask(acc.mt5Id);
                details.push(
                    result.failureReason === 'PASSWORD_DECRYPT_FAILED'
                        ? `${mask}: falha ao descriptografar senha MT5 no cofre do backend.`
                        : result.failureReason === 'PASSWORD_NOT_STORED'
                          ? `${mask}: senha MT5 não armazenada no cofre do backend.`
                          : `${mask}: login MT5 inválido.`,
                );
            }
        }

        return {
            totalAccounts: accounts.length,
            migrated,
            failed,
            skippedNoCredentials,
            skippedNoTarget,
            details,
        };
    }

    async migrateWorkerAccounts(fromWorkerId: string, targetWorkerId?: string) {
        const cleanFrom = String(fromWorkerId || '').trim();
        const cleanTarget = targetWorkerId ? String(targetWorkerId).trim() : undefined;
        if (!cleanFrom) {
            throw new BadRequestException('Identificador do servidor de origem é obrigatório.');
        }

        const workers = this.getWorkerInputsFromService();
        const healthyOthers = workers.filter(
            (w) =>
                w.workerId !== cleanFrom &&
                w.isOnline &&
                !w.isDraining &&
                !this.drainingWorkers.has(w.workerId),
        );
        if (healthyOthers.length === 0) {
            throw new BadRequestException(
                `Nenhum outro servidor worker MT5 online saudável está disponível para receber as contas de "${cleanFrom}".`,
            );
        }
        if (cleanTarget && !healthyOthers.some((w) => w.workerId === cleanTarget)) {
            throw new BadRequestException(
                `Servidor destino "${cleanTarget}" não está online ou está em modo Drain.`,
            );
        }

        const summary = await this.migrateWorkerAccountsInternal(
            cleanFrom,
            cleanTarget,
            'MANUAL_ADMIN',
            `Migração de servidor solicitada pelo administrador (${cleanFrom} → ${cleanTarget || 'auto'}).`,
            1,
        );

        if (summary.totalAccounts === 0) {
            return {
                success: true,
                fromWorkerId: cleanFrom,
                toWorkerId: cleanTarget || healthyOthers[0].workerId,
                ...summary,
                message: `O servidor ${cleanFrom} não possui contas MT5 alocadas para migrar.`,
            };
        }

        if (summary.migrated === 0 && summary.failed > 0) {
            throw new BadRequestException(
                `Nenhuma das ${summary.totalAccounts} conta(s) de ${cleanFrom} pôde ser migrada: ${summary.details.slice(0, 3).join(' | ')}`,
            );
        }

        return {
            success: true,
            fromWorkerId: cleanFrom,
            toWorkerId: cleanTarget || 'AUTO',
            ...summary,
            message:
                summary.failed > 0
                    ? `Migração da VPS ${cleanFrom}: ${summary.migrated} iniciada(s), ${summary.failed} impedida(s). ${summary.details.slice(0, 2).join(' | ')}`
                    : `Migração silenciosa da VPS ${cleanFrom} iniciada para ${summary.migrated} conta(s) sem desconectar os utilizadores.`,
        };
    }

    async rebalanceCluster() {
        const workers = this.getWorkerInputsFromService().filter(
            (w) => w.isOnline && !w.isDraining && !this.drainingWorkers.has(w.workerId),
        );
        if (workers.length < 2) {
            return { success: true, moved: 0, message: 'São necessários pelo menos 2 workers ativos para rebalanceamento.' };
        }

        const stride = this.getPairStride();
        const assignedCounts = await this.computeAssignedCountsByWorker();
        const accounts = await this.accountRepo.find({
            where: { isArchived: false, isConnected: true },
            order: { updatedAt: 'ASC' },
        });

        let moved = 0;
        const maxMoves = 4;

        for (const acc of accounts) {
            if (moved >= maxMoves) break;
            if (!acc.assignedWorkerId || !acc.mt5Id) continue;

            const currentCount = assignedCounts[acc.assignedWorkerId] || 0;
            const minCount = Math.min(...workers.map((w) => assignedCounts[w.workerId] || 0));
            if (currentCount - minCount <= stride) continue;

            const openPositions = await this.positionRepo.count({ where: { accountId: acc.id } });
            if (openPositions > 0) continue;

            const target = this.selectWorkerForAccount(workers, assignedCounts, {
                excludeWorkerIds: [acc.assignedWorkerId],
            });
            if (!target) continue;

            const oldWorker = acc.assignedWorkerId;
            const result = await this.executeSilentAccountMigration(
                acc,
                target.workerId,
                'CLUSTER_REBALANCE',
                `Rebalanceamento Pair-Stride K=${stride} (${oldWorker} → ${target.workerId}).`,
                { priority: 3, requireStoredPassword: true },
            );
            if (result.migrated) {
                assignedCounts[oldWorker] = Math.max(0, (assignedCounts[oldWorker] || 1) - 1);
                assignedCounts[target.workerId] = (assignedCounts[target.workerId] || 0) + 1;
                moved++;
            }
        }

        return { success: true, moved };
    }

    private computeTelemetryId(accountUuid: string): string {
        return createHash('sha256')
            .update(String(accountUuid))
            .digest('hex')
            .slice(0, 8)
            .toUpperCase();
    }

    private formatAccountMask(rawLogin: string): string {
        const clean = String(rawLogin || '').trim();
        const last4 = clean.length >= 4 ? clean.slice(-4) : clean.replace(/./g, '•');
        return last4 ? `MT5 ••••${last4}` : 'MT5 ••••';
    }

    private resolveSafeDisplayName(
        rawAccountName: string | null | undefined,
        rawLogin: string,
        ownerName?: string | null,
        holderName?: string | null,
    ): string | null {
        const sanitize = (val?: string | null) => {
            const trimmed = String(val || '').trim();
            if (!trimmed) return '';
            const cleanLogin = String(rawLogin || '').trim();
            const stripped = cleanLogin
                ? trimmed.split(cleanLogin).join('').replace(/\s{2,}/g, ' ').trim()
                : trimmed;
            const noEmail = stripped
                .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
                .replace(/\s{2,}/g, ' ')
                .trim();
            if (!noEmail || /^mt5$/i.test(noEmail) || /^conta principal$/i.test(noEmail)) {
                return '';
            }
            return noEmail.slice(0, 80);
        };

        const cleanOwner = sanitize(ownerName);
        const cleanCustomName = sanitize(rawAccountName);
        const cleanHolder = sanitize(holderName);

        if (cleanOwner && cleanCustomName && cleanOwner.toLowerCase() !== cleanCustomName.toLowerCase()) {
            return `${cleanOwner} · ${cleanCustomName}`;
        }
        return cleanOwner || cleanCustomName || cleanHolder || null;
    }

    async reconnectAccountByTelemetryId(telemetryId: string) {
        const cleanTelemetryId = String(telemetryId || '').trim().toUpperCase();
        if (!/^[0-9A-F]{8}$/.test(cleanTelemetryId)) {
            throw new BadRequestException('Identificador de telemetria inválido.');
        }

        const trackedAccounts = await this.accountRepo.find({
            where: { isArchived: false, mt5Id: Not(IsNull()) },
            select: [
                'id',
                'name',
                'userId',
                'mt5Id',
                'broker',
                'isConnected',
                'assignedWorkerId',
                'mt5LeaseEpoch',
                'mt5SyncTier',
                'inactivityWarnedAt',
                'inactivityDisconnectAt',
            ],
        });

        const account = trackedAccounts.find(
            (acc) => this.computeTelemetryId(acc.id) === cleanTelemetryId,
        );
        if (!account) {
            throw new NotFoundException('Conta MT5 não encontrada na telemetria.');
        }

        const cleanLogin = String(account.mt5Id || '').trim();
        if (!/^\d{4,16}$/.test(cleanLogin)) {
            throw new BadRequestException(
                'Esta conta possui um login MT5 inválido e não pode ser reconectada automaticamente.',
            );
        }

        if (!this.mt5WorkerService) {
            throw new BadRequestException('Serviço de workers MT5 indisponível.');
        }

        const workers = this.getWorkerInputsFromService();
        const onlineWorkers = workers.filter((w) => w.isOnline);
        if (onlineWorkers.length === 0) {
            throw new BadRequestException(
                'Nenhum servidor worker MT5 está online no momento. Inicie um worker Windows MT5 antes de solicitar reconexão.',
            );
        }

        const cleanServer = this.mt5WorkerService.normalizeBrokerServer(
            String(account.broker || '').trim(),
        );
        const previousWorker = account.assignedWorkerId || null;
        const passCheck = await this.inspectStoredPassword(account.id);
        const storedPass = passCheck.password;
        const assignment = await this.assignWorkerForAccount(account.id, workers);

        const targetWorker = assignment.workerId || previousWorker;
        const targetWorkerState = workers.find((w) => w.workerId === targetWorker);
        if (!targetWorker || !targetWorkerState?.isOnline) {
            throw new BadRequestException(
                `O servidor atribuído (${targetWorker || 'nenhum'}) está offline e nenhum worker saudável pôde assumir a conta.`,
            );
        }

        const movedToDifferentWorker = Boolean(previousWorker && previousWorker !== targetWorker);
        if (!storedPass && movedToDifferentWorker) {
            throw new BadRequestException(
                passCheck.status === 'DECRYPT_FAILED'
                    ? `Falha ao descriptografar a senha MT5 no cofre do backend (chave divergente) e o servidor anterior (${previousWorker}) está offline. Peça ao utilizador para reconectar com a senha.`
                    : `A senha MT5 não está armazenada no cofre do backend e o servidor anterior (${previousWorker}) está offline. Peça ao utilizador para reconectar com a senha uma vez.`,
            );
        }

        account.inactivityWarnedAt = null;
        account.inactivityDisconnectAt = null;
        account.mt5SyncTier = 'HOT';
        account.assignedWorkerId = targetWorker;
        account.mt5LeaseEpoch = assignment.leaseEpoch;
        await this.accountRepo.save(account);

        const numId = this.mt5WorkerService.deriveNumericAccountId(cleanLogin);
        const task = this.mt5WorkerService.createAccountTask(
            WorkerTaskType.START_ACCOUNT,
            cleanLogin,
            cleanServer,
            storedPass || undefined,
            numId,
            {
                userId: account.userId,
                accountUuid: account.id,
                targetWorkerId: targetWorker,
                leaseEpoch: assignment.leaseEpoch,
                priority: 1,
                adminTriggeredReconnect: true,
            },
        );

        const accountMask = this.formatAccountMask(cleanLogin);
        const ownerName = await this.resolveAccountOwnerName(account.userId);
        const accountName = this.resolveSafeDisplayName(account.name, cleanLogin, ownerName, null);
        this.logger.log(
            `[ADMIN-RECONNECT] Reconexão solicitada para ${accountMask} (#${cleanTelemetryId}) no worker ${targetWorker} (TaskID: ${task.id}, credStatus=${passCheck.status}).`,
        );

        return {
            success: true,
            telemetryId: cleanTelemetryId,
            accountMask,
            accountName,
            broker: cleanServer || null,
            workerId: targetWorker,
            workerOnline: true,
            previousWorkerId: previousWorker,
            taskId: task.id,
            taskStatus: 'QUEUED' as const,
            credentialStatus: passCheck.status,
            usedStoredCredentials: Boolean(storedPass),
            message: storedPass
                ? `Reconexão enfileirada para ${accountName || accountMask} no servidor ${targetWorker} (senha do cofre carregada · aguardando worker iniciar login MT5).`
                : passCheck.status === 'DECRYPT_FAILED'
                  ? `Reconexão enviada ao servidor ${targetWorker} via cofre local do worker (aviso: falha ao descriptografar senha no cofre do backend).`
                  : `Reconexão enviada ao servidor ${targetWorker} via cofre local do worker (aviso: senha não salva no cofre do backend).`,
        };
    }

    async getAccountTaskStatus(telemetryId: string, taskId: string) {
        const cleanTelemetryId = String(telemetryId || '').trim().toUpperCase();
        const cleanTaskId = String(taskId || '').trim();
        if (!/^[0-9A-F]{8}$/.test(cleanTelemetryId) || !cleanTaskId) {
            throw new BadRequestException('Parâmetros de consulta de tarefa inválidos.');
        }

        const trackedAccounts = await this.accountRepo.find({
            where: { isArchived: false, mt5Id: Not(IsNull()) },
            select: ['id', 'name', 'userId', 'mt5Id', 'broker', 'isConnected', 'assignedWorkerId', 'mt5LeaseEpoch', 'mt5SyncTier'],
        });
        const account = trackedAccounts.find(
            (acc) => this.computeTelemetryId(acc.id) === cleanTelemetryId,
        );
        if (!account) {
            throw new NotFoundException('Conta MT5 não encontrada na telemetria.');
        }

        const cleanLogin = String(account.mt5Id || '').trim();
        const taskSummary = this.mt5WorkerService?.getTaskSummaryById?.(cleanTaskId) || null;
        const liveTel = this.mt5WorkerService?.getAnonymizedAccountTelemetry?.(
            cleanLogin,
            Boolean(account.isConnected),
        );
        const workers = this.getWorkerInputsFromService();
        const assignedWorker = workers.find((w) => w.workerId === account.assignedWorkerId);

        const taskStatus =
            taskSummary?.status ||
            (liveTel?.connectionState === 'CONNECTED' || account.isConnected ? 'SUCCESS' : 'UNKNOWN');

        return {
            telemetryId: cleanTelemetryId,
            taskId: cleanTaskId,
            taskStatus,
            connectionState: liveTel?.connectionState || (account.isConnected ? 'CONNECTED' : 'DISCONNECTED'),
            assignedWorkerId: account.assignedWorkerId || null,
            workerOnline: Boolean(assignedWorker?.isOnline),
            pingMs: liveTel?.pingMs ?? null,
            message: taskSummary?.message || liveTel?.feedback || null,
            errorMessage: taskSummary?.errorMessage || (liveTel?.connectionState === 'AUTH_FAILED' ? liveTel?.feedback : null),
            createdAt: taskSummary?.createdAt || null,
            completedAt: taskSummary?.completedAt || null,
        };
    }

    /**
     * Ação administrativa de 1 clique para migrar uma conta MT5 de um servidor worker para outro servidor online,
     * mantendo a conexão ativa de forma silenciosa para o utilizador e registrando o log apenas no Admin.
     */
    async migrateAccountByTelemetryId(telemetryId: string, targetWorkerId?: string) {
        const cleanTelemetryId = String(telemetryId || '').trim().toUpperCase();
        if (!/^[0-9A-F]{8}$/.test(cleanTelemetryId)) {
            throw new BadRequestException('Identificador de telemetria inválido.');
        }

        const trackedAccounts = await this.accountRepo.find({
            where: { isArchived: false, mt5Id: Not(IsNull()) },
            select: [
                'id',
                'name',
                'userId',
                'mt5Id',
                'broker',
                'isConnected',
                'assignedWorkerId',
                'mt5LeaseEpoch',
                'mt5SyncTier',
                'inactivityWarnedAt',
                'inactivityDisconnectAt',
            ],
        });

        const account = trackedAccounts.find(
            (acc) => this.computeTelemetryId(acc.id) === cleanTelemetryId,
        );
        if (!account) {
            throw new NotFoundException('Conta MT5 não encontrada na telemetria.');
        }

        const cleanLogin = String(account.mt5Id || '').trim();
        if (!/^\d{4,16}$/.test(cleanLogin)) {
            throw new BadRequestException('Conta com login MT5 inválido para migração.');
        }

        const workers = this.getWorkerInputsFromService();
        const onlineWorkers = workers.filter(
            (w) => w.isOnline && !w.isDraining && !this.drainingWorkers.has(w.workerId),
        );
        if (onlineWorkers.length === 0) {
            throw new BadRequestException('Nenhum servidor worker online disponível para migração.');
        }

        const requestedTarget = String(targetWorkerId || '').trim();
        let chosenWorker: BalancerWorkerInput | null = null;
        if (requestedTarget) {
            chosenWorker = onlineWorkers.find((w) => w.workerId === requestedTarget) || null;
            if (!chosenWorker) {
                throw new BadRequestException(
                    `Servidor de destino "${requestedTarget}" não está online ou encontra-se em modo Drain.`,
                );
            }
            if (account.assignedWorkerId && account.assignedWorkerId === chosenWorker.workerId) {
                throw new BadRequestException(
                    `A conta já está alocada no servidor "${chosenWorker.workerId}".`,
                );
            }
        } else {
            const assignedCounts = await this.computeAssignedCountsByWorker();
            chosenWorker = this.selectWorkerForAccount(workers, assignedCounts, {
                excludeWorkerIds: account.assignedWorkerId ? [account.assignedWorkerId] : [],
            });
            if (!chosenWorker) {
                throw new BadRequestException(
                    'Não há outro servidor worker online saudável disponível para receber esta conta.',
                );
            }
        }

        const oldWorker = account.assignedWorkerId || null;
        const result = await this.executeSilentAccountMigration(
            account,
            chosenWorker.workerId,
            'MANUAL_ADMIN',
            `Troca manual de servidor solicitada pelo administrador (${oldWorker || 'sem-servidor'} → ${chosenWorker.workerId}).`,
            { priority: 1, requireStoredPassword: true },
        );

        if (!result.migrated || !result.migrationLog) {
            throw new BadRequestException(
                result.failureReason === 'PASSWORD_DECRYPT_FAILED'
                    ? 'Falha ao descriptografar a senha MT5 desta conta no cofre do backend (chave de criptografia divergente). Peça ao cliente para reconectar com a senha ou verifique a configuração das chaves de cofre.'
                    : 'Não foi possível migrar esta conta porque a senha MT5 não está armazenada no cofre criptografado do backend. Peça ao cliente para reconectar uma vez ou use Reconectar no servidor atual.',
            );
        }

        return {
            success: true,
            telemetryId: cleanTelemetryId,
            accountMask: result.migrationLog.accountMask,
            fromWorkerId: oldWorker,
            toWorkerId: chosenWorker.workerId,
            leaseEpoch: result.migrationLog.leaseEpoch,
            taskId: result.taskId,
            migrationId: result.migrationLog.id,
            message: `Migração silenciosa iniciada: ${result.migrationLog.accountName || result.migrationLog.accountMask} (${oldWorker || 'sem servidor'} → ${chosenWorker.workerId}). A conexão do cliente permanece ativa.`,
        };
    }

    async getClusterOverview() {
        const workers = this.getWorkerInputsFromService();
        const counts = await this.computeAssignedCountsByWorker();
        const trackedAccounts = await this.accountRepo.find({
            where: { isArchived: false, mt5Id: Not(IsNull()) },
            select: [
                'id',
                'name',
                'userId',
                'mt5Id',
                'broker',
                'isConnected',
                'lastSeen',
                'assignedWorkerId',
                'mt5SyncTier',
                'mt5LeaseEpoch',
                'zeroBalanceSince',
                'inactivityWarnedAt',
                'inactivityDisconnectAt',
            ],
        });

        const hasStoredPassByAccountId = new Map<string, boolean>();
        try {
            const rows: Array<{ id: string; has_pass: boolean }> = await this.accountRepo.manager?.query?.(
                `SELECT id, (mt5_encrypted_pass IS NOT NULL AND TRIM(mt5_encrypted_pass) <> '') AS has_pass FROM accounts WHERE is_archived = false AND mt5_id IS NOT NULL`,
            );
            for (const r of rows || []) {
                hasStoredPassByAccountId.set(String(r.id), Boolean(r.has_pass));
            }
        } catch {
            // Fallback seguro em mocks de teste
        }

        const ownerNameByUserId = new Map<string, string>();
        if (this.userRepo && typeof this.userRepo.find === 'function') {
            const userIds = Array.from(
                new Set(
                    trackedAccounts
                        .map((a) => a.userId)
                        .filter((uid): uid is string => Boolean(uid)),
                ),
            );
            if (userIds.length > 0) {
                try {
                    const users = await this.userRepo.find({
                        where: { id: In(userIds) },
                        select: ['id', 'name', 'username'],
                    });
                    for (const u of users || []) {
                        const label = String(u.name || u.username || '').trim();
                        if (u.id && label) {
                            ownerNameByUserId.set(u.id, label);
                        }
                    }
                } catch {
                    // fallback seguro caso o repositório de usuários não suporte batch find
                }
            }
        }

        const tierSummary = { HOT: 0, WARM: 0, COLD: 0, QUARANTINED: 0, pendingDisconnect: 0 };
        const stateSummary = {
            CONNECTED: 0,
            SYNCING: 0,
            CONNECTING: 0,
            DISCONNECTED: 0,
            AUTH_FAILED: 0,
        };
        let totalConnectedAccounts = 0;

        const accounts = trackedAccounts.map((acc) => {
            const rawLogin = String(acc.mt5Id || '').trim();
            const telemetryId = this.computeTelemetryId(acc.id);
            const accountMask = this.formatAccountMask(rawLogin);

            const liveTel = this.mt5WorkerService?.getAnonymizedAccountTelemetry?.(
                rawLogin,
                Boolean(acc.isConnected),
            );
            const connectionState =
                liveTel?.connectionState || (acc.isConnected ? 'CONNECTED' : 'DISCONNECTED');

            const ownerName = acc.userId ? ownerNameByUserId.get(acc.userId) || null : null;
            const accountName = this.resolveSafeDisplayName(
                acc.name,
                rawLogin,
                ownerName,
                liveTel?.accountHolderName || null,
            );

            if (connectionState in stateSummary) {
                (stateSummary as any)[connectionState]++;
            }
            if (acc.isConnected || connectionState === 'CONNECTED' || connectionState === 'SYNCING') {
                totalConnectedAccounts++;
            }

            const tier = String(acc.mt5SyncTier || 'HOT').toUpperCase();
            if (acc.isConnected && tier in tierSummary) {
                (tierSummary as any)[tier]++;
            }
            if (acc.inactivityDisconnectAt) tierSummary.pendingDisconnect++;

            const fallbackFeedback = acc.inactivityDisconnectAt
                ? 'Aviso de hibernação 24h ativo (conta sem atividade).'
                : acc.mt5SyncTier === 'QUARANTINED'
                  ? 'Sincronização em quarentena temporária por falha de ligação.'
                  : null;

            const latestTask = liveTel?.latestTask || null;
            const hasStoredCredentials = hasStoredPassByAccountId.has(acc.id)
                ? Boolean(hasStoredPassByAccountId.get(acc.id))
                : true;

            return {
                telemetryId,
                accountMask,
                accountName,
                hasStoredCredentials,
                connectionState,
                syncTier: tier,
                assignedWorkerId: acc.assignedWorkerId || null,
                leaseEpoch: Number(acc.mt5LeaseEpoch || 1),
                pingMs: liveTel?.pingMs ?? null,
                terminalBuild: liveTel?.terminalBuild ?? null,
                openPositionsCount: liveTel?.openPositionsCount ?? null,
                lastSyncAt:
                    liveTel?.lastSyncAt ||
                    (acc.lastSeen ? new Date(acc.lastSeen).toISOString() : null),
                zeroBalanceFlag: Boolean(acc.zeroBalanceSince),
                inactivityWarnedAt: acc.inactivityWarnedAt
                    ? new Date(acc.inactivityWarnedAt).toISOString()
                    : null,
                inactivityDisconnectAt: acc.inactivityDisconnectAt
                    ? new Date(acc.inactivityDisconnectAt).toISOString()
                    : null,
                feedback:
                    latestTask?.errorMessage ||
                    liveTel?.feedback ||
                    latestTask?.message ||
                    fallbackFeedback,
                lastTaskId: latestTask?.taskId || null,
                lastTaskStatus: latestTask?.status || null,
                lastTaskMessage: latestTask?.message || null,
                lastTaskError: latestTask?.errorMessage || null,
                lastTaskUpdatedAt: latestTask?.completedAt || latestTask?.createdAt || null,
            };
        });

        return {
            stride: this.getPairStride(),
            totalTrackedAccounts: trackedAccounts.length,
            totalConnectedAccounts,
            tierSummary,
            stateSummary,
            workers: workers.map((w) => {
                const wAccounts = accounts.filter((a) => a.assignedWorkerId === w.workerId);
                const wConnected = wAccounts.filter(
                    (a) => a.connectionState === 'CONNECTED' || a.connectionState === 'SYNCING',
                ).length;
                const wAlerts = wAccounts.filter(
                    (a) => a.connectionState === 'DISCONNECTED' || a.connectionState === 'AUTH_FAILED',
                ).length;
                const pings = wAccounts
                    .map((a) => a.pingMs)
                    .filter((p): p is number => typeof p === 'number' && Number.isFinite(p));
                const avgPingMs =
                    pings.length > 0
                        ? Math.round(pings.reduce((acc, v) => acc + v, 0) / pings.length)
                        : null;
                const wTiers = { HOT: 0, WARM: 0, COLD: 0, QUARANTINED: 0 };
                for (const a of wAccounts) {
                    if (a.syncTier in wTiers) {
                        (wTiers as any)[a.syncTier]++;
                    }
                }
                const assignedCount = counts[w.workerId] ?? wAccounts.length;
                return {
                    ...w,
                    assignedAccountsCount: assignedCount,
                    pairBucketsCompleted: Math.floor(assignedCount / this.getPairStride()),
                    connectedCount: wConnected,
                    alertCount: wAlerts,
                    avgPingMs,
                    tierBreakdown: wTiers,
                    accountTags: wAccounts.map((a) => ({
                        telemetryId: a.telemetryId,
                        accountMask: a.accountMask,
                        accountName: a.accountName,
                        connectionState: a.connectionState,
                        syncTier: a.syncTier,
                        leaseEpoch: a.leaseEpoch,
                        pingMs: a.pingMs,
                    })),
                };
            }),
            correlations: (() => {
                const onlineWorkers = workers.filter((w) => w.isOnline);
                const onlineCounts = onlineWorkers.map(
                    (w) => counts[w.workerId] ?? accounts.filter((a) => a.assignedWorkerId === w.workerId).length,
                );
                const maxLoad = onlineCounts.length ? Math.max(...onlineCounts) : 0;
                const minLoad = onlineCounts.length ? Math.min(...onlineCounts) : 0;
                const unassignedCount = accounts.filter((a) => !a.assignedWorkerId).length;
                const avgAccountsPerOnlineWorker =
                    onlineWorkers.length > 0
                        ? Number(
                              (
                                  onlineCounts.reduce((acc, v) => acc + v, 0) / onlineWorkers.length
                              ).toFixed(2),
                          )
                        : 0;

                const workerCorrelation = workers.map((w) => {
                    const wAccounts = accounts.filter((a) => a.assignedWorkerId === w.workerId);
                    const assigned = counts[w.workerId] ?? wAccounts.length;
                    const connected = wAccounts.filter(
                        (a) => a.connectionState === 'CONNECTED' || a.connectionState === 'SYNCING',
                    ).length;
                    const alerts = wAccounts.filter(
                        (a) => a.connectionState === 'DISCONNECTED' || a.connectionState === 'AUTH_FAILED',
                    ).length;
                    const pings = wAccounts
                        .map((a) => a.pingMs)
                        .filter((p): p is number => typeof p === 'number' && Number.isFinite(p));
                    const avgPingMs =
                        pings.length > 0
                            ? Math.round(pings.reduce((acc, v) => acc + v, 0) / pings.length)
                            : null;
                    const capacity = Math.max(1, Number(w.capacity || 1));
                    return {
                        workerId: w.workerId,
                        isOnline: w.isOnline,
                        assignedAccountsCount: assigned,
                        slotUtilizationPct: Math.round((assigned / capacity) * 100),
                        connectedRatePct: assigned > 0 ? Math.round((connected / assigned) * 100) : 100,
                        alertCount: alerts,
                        avgPingMs,
                        cpuPercent: typeof w.cpuPercent === 'number' ? Number(w.cpuPercent.toFixed(1)) : null,
                        memoryPercent:
                            typeof w.memoryPercent === 'number' ? Number(w.memoryPercent.toFixed(1)) : null,
                    };
                });

                return {
                    onlineWorkersCount: onlineWorkers.length,
                    unassignedCount,
                    pairStrideBalanceGap: Math.max(0, maxLoad - minLoad),
                    avgAccountsPerOnlineWorker,
                    workerCorrelation,
                };
            })(),
            accounts,
            migrationLogs: this.migrationLogs.slice(0, 50),
        };
    }

    private async inspectStoredPassword(
        accountId: string,
    ): Promise<{ password: string | null; status: 'OK' | 'NOT_STORED' | 'DECRYPT_FAILED' }> {
        try {
            const row = await this.accountRepo
                .createQueryBuilder('acc')
                .addSelect('acc.mt5EncryptedPass')
                .where('acc.id = :id', { id: accountId })
                .getOne();
            const enc = row?.mt5EncryptedPass;
            if (!enc || !String(enc).trim()) {
                return { password: null, status: 'NOT_STORED' };
            }
            if (!enc.includes(':')) {
                return { password: enc, status: 'OK' };
            }

            const keyring = getMt5CredentialKeyring(this.configService);
            const cleanLogin = String(row?.mt5Id || '').trim();
            if (row?.userId && cleanLogin) {
                try {
                    const plain = CryptoUtil.decrypt(enc, keyring, {
                        aad: `mt5:${row.userId}:${cleanLogin}`,
                    });
                    if (plain) return { password: plain, status: 'OK' };
                } catch {
                    // Fallback para credenciais legadas gravadas sem binding AAD
                }
            }
            const legacyPlain = CryptoUtil.decrypt(enc, keyring);
            return legacyPlain
                ? { password: legacyPlain, status: 'OK' }
                : { password: null, status: 'DECRYPT_FAILED' };
        } catch {
            return { password: null, status: 'DECRYPT_FAILED' };
        }
    }

    private async decryptStoredPassword(accountId: string): Promise<string | null> {
        const res = await this.inspectStoredPassword(accountId);
        return res.password;
    }

    private async resolveUserLocale(userId?: string | null): Promise<'pt' | 'en'> {
        if (!userId || !this.userRepo) return 'pt';
        try {
            const user = await this.userRepo.findOne({
                where: { id: userId },
                select: ['id', 'preferredLocale'],
            });
            return user?.preferredLocale === 'en' ? 'en' : 'pt';
        } catch {
            return 'pt';
        }
    }
}
