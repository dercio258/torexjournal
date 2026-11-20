import {
    Injectable,
    Logger,
    OnModuleInit,
    Optional,
    Inject,
    forwardRef,
    NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Interval } from '@nestjs/schedule';
import { Repository, IsNull, Not } from 'typeorm';
import { AccountEntity, AccountType } from '../../account/account.entity';
import { PositionEntity } from '../position.entity';
import { NotificationEntity, NotificationType } from '../../notifications/notification.entity';
import { PushProducerService } from '../../notifications/push/push-producer.service';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { getMt5CredentialSecret } from '../../common/security/security.config';
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
            `);
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

    /**
     * Detecta VPS/workers offline há mais de 90s e migra as suas contas conectadas para outros nós saudáveis.
     */
    async evaluateDeadWorkerFailover(nowMs: number = Date.now()): Promise<{ migrated: number }> {
        const workers = this.getWorkerInputsFromService();
        if (workers.length === 0) return { migrated: 0 };

        const healthyNodes = workers.filter(
            (w) => w.isOnline && !w.isDraining && !this.drainingWorkers.has(w.workerId),
        );
        if (healthyNodes.length === 0) return { migrated: 0 };

        const deadWorkerIds = new Set(
            workers
                .filter((w) => {
                    const hbMs = w.lastHeartbeat ? new Date(w.lastHeartbeat).getTime() : 0;
                    return !w.isOnline && hbMs > 0 && nowMs - hbMs > DEAD_WORKER_FAILOVER_MS;
                })
                .map((w) => w.workerId),
        );

        if (deadWorkerIds.size === 0) return { migrated: 0 };

        let migrated = 0;
        const accounts = await this.accountRepo.find({
            where: { isArchived: false, isConnected: true },
        });
        const assignedCounts = await this.computeAssignedCountsByWorker();

        for (const acc of accounts) {
            if (!acc.assignedWorkerId || !deadWorkerIds.has(acc.assignedWorkerId)) continue;
            if (!acc.mt5Id) continue;

            const oldWorker = acc.assignedWorkerId;
            const target = this.selectWorkerForAccount(workers, assignedCounts, {
                excludeWorkerIds: [oldWorker],
            });
            if (!target) break;

            const pass = await this.decryptStoredPassword(acc.id);
            if (!pass) continue; // Sem senha armazenada, aguarda próxima reconexão

            acc.assignedWorkerId = target.workerId;
            acc.mt5LeaseEpoch = Number(acc.mt5LeaseEpoch || 1) + 1;
            await this.accountRepo.save(acc);

            assignedCounts[target.workerId] = (assignedCounts[target.workerId] || 0) + 1;
            this.queueEviction(oldWorker, acc.mt5Id);

            if (this.mt5WorkerService) {
                const numId = this.mt5WorkerService.deriveNumericAccountId(acc.mt5Id);
                this.mt5WorkerService.createAccountTask(
                    WorkerTaskType.START_ACCOUNT,
                    acc.mt5Id,
                    acc.broker || '',
                    pass,
                    numId,
                    {
                        userId: acc.userId,
                        accountUuid: acc.id,
                        targetWorkerId: target.workerId,
                        leaseEpoch: acc.mt5LeaseEpoch,
                        priority: 2,
                    },
                );
            }
            migrated++;
            this.logger.warn(
                `[CLUSTER-FAILOVER] Conta ${acc.id} (${acc.mt5Id}) migrada de ${oldWorker} -> ${target.workerId} (epoch=${acc.mt5LeaseEpoch}).`,
            );
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

        if (drain) {
            const workers = this.getWorkerInputsFromService();
            const accounts = await this.accountRepo.find({
                where: { assignedWorkerId: workerId, isArchived: false, isConnected: true },
            });
            const assignedCounts = await this.computeAssignedCountsByWorker();

            for (const acc of accounts) {
                if (!acc.mt5Id) continue;
                const target = this.selectWorkerForAccount(workers, assignedCounts, {
                    excludeWorkerIds: [workerId],
                });
                if (!target) break;

                const pass = await this.decryptStoredPassword(acc.id);
                if (!pass) continue;

                acc.assignedWorkerId = target.workerId;
                acc.mt5LeaseEpoch = Number(acc.mt5LeaseEpoch || 1) + 1;
                await this.accountRepo.save(acc);

                assignedCounts[target.workerId] = (assignedCounts[target.workerId] || 0) + 1;
                this.queueEviction(workerId, acc.mt5Id);

                if (this.mt5WorkerService) {
                    const numId = this.mt5WorkerService.deriveNumericAccountId(acc.mt5Id);
                    this.mt5WorkerService.createAccountTask(
                        WorkerTaskType.START_ACCOUNT,
                        acc.mt5Id,
                        acc.broker || '',
                        pass,
                        numId,
                        {
                            userId: acc.userId,
                            accountUuid: acc.id,
                            targetWorkerId: target.workerId,
                            leaseEpoch: acc.mt5LeaseEpoch,
                            priority: 2,
                        },
                    );
                }
                migrated++;
            }
        }

        return { success: true, workerId, draining: drain, migrated };
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

            const pass = await this.decryptStoredPassword(acc.id);
            if (!pass) continue;

            const target = this.selectWorkerForAccount(workers, assignedCounts, {
                excludeWorkerIds: [acc.assignedWorkerId],
            });
            if (!target) continue;

            const oldWorker = acc.assignedWorkerId;
            acc.assignedWorkerId = target.workerId;
            acc.mt5LeaseEpoch = Number(acc.mt5LeaseEpoch || 1) + 1;
            await this.accountRepo.save(acc);

            assignedCounts[oldWorker] = Math.max(0, (assignedCounts[oldWorker] || 1) - 1);
            assignedCounts[target.workerId] = (assignedCounts[target.workerId] || 0) + 1;
            this.queueEviction(oldWorker, acc.mt5Id);

            if (this.mt5WorkerService) {
                const numId = this.mt5WorkerService.deriveNumericAccountId(acc.mt5Id);
                this.mt5WorkerService.createAccountTask(
                    WorkerTaskType.START_ACCOUNT,
                    acc.mt5Id,
                    acc.broker || '',
                    pass,
                    numId,
                    {
                        userId: acc.userId,
                        accountUuid: acc.id,
                        targetWorkerId: target.workerId,
                        leaseEpoch: acc.mt5LeaseEpoch,
                        priority: 3,
                    },
                );
            }
            moved++;
        }

        return { success: true, moved };
    }

    async getClusterOverview() {
        const workers = this.getWorkerInputsFromService();
        const counts = await this.computeAssignedCountsByWorker();
        const connectedAccounts = await this.accountRepo.find({
            where: { isArchived: false, isConnected: true },
            select: [
                'id',
                'assignedWorkerId',
                'mt5SyncTier',
                'mt5LeaseEpoch',
                'zeroBalanceSince',
                'inactivityWarnedAt',
                'inactivityDisconnectAt',
            ],
        });

        const tierSummary = { HOT: 0, WARM: 0, COLD: 0, QUARANTINED: 0, pendingDisconnect: 0 };
        for (const a of connectedAccounts) {
            const tier = String(a.mt5SyncTier || 'HOT').toUpperCase();
            if (tier in tierSummary) {
                (tierSummary as any)[tier]++;
            }
            if (a.inactivityDisconnectAt) tierSummary.pendingDisconnect++;
        }

        return {
            stride: this.getPairStride(),
            totalConnectedAccounts: connectedAccounts.length,
            tierSummary,
            workers: workers.map((w) => ({
                ...w,
                assignedAccountsCount: counts[w.workerId] || 0,
                pairBucketsCompleted: Math.floor((counts[w.workerId] || 0) / this.getPairStride()),
            })),
        };
    }

    private async decryptStoredPassword(accountId: string): Promise<string | null> {
        try {
            const row = await this.accountRepo
                .createQueryBuilder('acc')
                .addSelect('acc.mt5EncryptedPass')
                .where('acc.id = :id', { id: accountId })
                .getOne();
            const enc = row?.mt5EncryptedPass;
            if (!enc) return null;
            return enc.includes(':')
                ? CryptoUtil.decrypt(enc, getMt5CredentialSecret(this.configService))
                : enc;
        } catch {
            return null;
        }
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
