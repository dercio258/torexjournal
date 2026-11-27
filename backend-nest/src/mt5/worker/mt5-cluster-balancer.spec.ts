import { NotFoundException } from '@nestjs/common';
import { Mt5ClusterBalancerService, humanizeClientSyncMessage } from './mt5-cluster-balancer.service';
import { AccountType } from '../../account/account.entity';

describe('Mt5ClusterBalancerService (Pair-Stride K=2, Lifecycle & Humanized Notifications)', () => {
    function createBalancerHarness(options?: {
        accounts?: any[];
        workers?: any[];
        positionsCountByAccount?: Record<string, number>;
        locale?: 'pt' | 'en';
    }) {
        const accounts = (options?.accounts || []).map((a) => ({ ...a }));
        const savedNotifications: any[] = [];
        const sentPushes: Array<{ userId: string; accountName: string; locale?: string }> = [];
        const dispatchedTasks: any[] = [];

        const accountRepo: any = {
            find: jest.fn(async () => accounts),
            findOne: jest.fn(async ({ where }: any) => {
                return accounts.find(
                    (a) =>
                        (!where.id || a.id === where.id) &&
                        (!where.userId || a.userId === where.userId),
                ) || null;
            }),
            save: jest.fn(async (acc: any) => {
                const idx = accounts.findIndex((a) => a.id === acc.id);
                if (idx >= 0) accounts[idx] = { ...accounts[idx], ...acc };
                else accounts.push(acc);
                return acc;
            }),
            createQueryBuilder: jest.fn(() => {
                let targetId = '';
                const qb: any = {
                    addSelect: jest.fn(() => qb),
                    where: jest.fn((_q: string, params: any) => {
                        targetId = params.id;
                        return qb;
                    }),
                    getOne: jest.fn(async () => accounts.find((a) => a.id === targetId) || null),
                };
                return qb;
            }),
            manager: { query: jest.fn(async () => []) },
        };

        const positionRepo: any = {
            count: jest.fn(async ({ where }: any) => {
                return options?.positionsCountByAccount?.[where?.accountId] ?? 0;
            }),
        };

        const notificationRepo: any = {
            create: jest.fn((data: any) => ({ id: `notif-${savedNotifications.length + 1}`, ...data })),
            save: jest.fn(async (n: any) => {
                savedNotifications.push(n);
                return n;
            }),
        };

        const workersState: any[] = options?.workers ? [...options.workers] : [];
        const mt5WorkerService: any = {
            getWorkerStatus: jest.fn(() => workersState),
            deriveNumericAccountId: jest.fn((login: string) => Number(login) || 1),
            normalizeBrokerServer: jest.fn((srv: string) => String(srv || '').trim()),
            createAccountTask: jest.fn((...args: any[]) => {
                dispatchedTasks.push(args);
                return { id: `task-${dispatchedTasks.length}` };
            }),
        };

        const pushProducer: any = {
            sendIdleAccountShutdownWarning: jest.fn(
                async (userId: string, accountName: string, locale?: string) => {
                    sentPushes.push({ userId, accountName, locale });
                    return true;
                },
            ),
        };

        const userRepo: any = {
            findOne: jest.fn(async () => ({ id: 'u1', preferredLocale: options?.locale || 'pt' })),
            find: jest.fn(async () => [
                { id: 'u1', name: 'Trader Alpha', username: 'alpha' },
                { id: 'secret-user-99', name: 'Charlote Trader', username: 'charlote' },
            ]),
        };

        const balancer = new Mt5ClusterBalancerService(
            accountRepo,
            positionRepo,
            notificationRepo,
            mt5WorkerService,
            pushProducer,
            undefined,
            userRepo,
        );

        return {
            balancer,
            accounts,
            savedNotifications,
            sentPushes,
            dispatchedTasks,
            workersState,
        };
    }

    it('distributes accounts in Pair-Stride (K=2): 1-2 -> VPS1, 3-4 -> VPS2, 5-6 -> VPS1, 7-8 -> VPS2', () => {
        const { balancer } = createBalancerHarness();
        const workers = [
            { workerId: 'vps-win-1', capacity: 20, isOnline: true, cpuPercent: 15, memoryPercent: 40, registrationOrder: 1 },
            { workerId: 'vps-win-2', capacity: 20, isOnline: true, cpuPercent: 18, memoryPercent: 42, registrationOrder: 2 },
        ];
        const counts: Record<string, number> = { 'vps-win-1': 0, 'vps-win-2': 0 };
        const assignments: string[] = [];

        for (let i = 1; i <= 8; i++) {
            const chosen = balancer.selectWorkerForAccount(workers, counts, { stride: 2 });
            expect(chosen).not.toBeNull();
            assignments.push(chosen!.workerId);
            counts[chosen!.workerId] += 1;
        }

        expect(assignments).toEqual([
            'vps-win-1', 'vps-win-1', // Contas 1 & 2 -> VPS 1
            'vps-win-2', 'vps-win-2', // Contas 3 & 4 -> VPS 2
            'vps-win-1', 'vps-win-1', // Contas 5 & 6 -> VPS 1
            'vps-win-2', 'vps-win-2', // Contas 7 & 8 -> VPS 2
        ]);
    });

    it('self-heals an incomplete pair after a disconnect and respects CPU/RAM hardware guards', () => {
        const { balancer } = createBalancerHarness();
        const workers = [
            { workerId: 'vps-win-1', capacity: 20, isOnline: true, cpuPercent: 20, memoryPercent: 50, registrationOrder: 1 },
            { workerId: 'vps-win-2', capacity: 20, isOnline: true, cpuPercent: 95, memoryPercent: 50, registrationOrder: 2 },
            { workerId: 'vps-win-3', capacity: 20, isOnline: true, cpuPercent: 10, memoryPercent: 30, registrationOrder: 3 },
        ];

        // VPS 1 tem 1/2 contas (par incompleto), VPS 2 está bloqueada por CPU=95%, VPS 3 tem 0/2
        const chosen = balancer.selectWorkerForAccount(workers, {
            'vps-win-1': 1,
            'vps-win-2': 0,
            'vps-win-3': 0,
        }, { stride: 2 });
        expect(chosen?.workerId).toBe('vps-win-1');

        // Agora VPS 1 fecha o par [2] -> pula VPS 2 (CPU saturada) e envia para VPS 3!
        const nextChosen = balancer.selectWorkerForAccount(workers, {
            'vps-win-1': 2,
            'vps-win-2': 0,
            'vps-win-3': 0,
        }, { stride: 2 });
        expect(nextChosen?.workerId).toBe('vps-win-3');
    });

    it('emits non-technical 24h warning at day 7 of $0 balance, allows Keep-Alive, and disconnects after 24h if unconfirmed', async () => {
        const now = Date.now();
        const eightDaysAgo = new Date(now - 8 * 86_400_000);
        const {
            balancer,
            accounts,
            savedNotifications,
            sentPushes,
            dispatchedTasks,
        } = createBalancerHarness({
            accounts: [
                {
                    id: 'acc-idle-1',
                    userId: 'u1',
                    name: 'Conta Prop',
                    mt5Id: '5001234',
                    broker: 'Exness-MT5Trial',
                    type: AccountType.LIVE,
                    balance: 0,
                    equity: 0,
                    isConnected: true,
                    isArchived: false,
                    assignedWorkerId: 'vps-win-1',
                    mt5LeaseEpoch: 1,
                    mt5SyncTier: 'HOT',
                    zeroBalanceSince: eightDaysAgo,
                    inactivityWarnedAt: null,
                    inactivityDisconnectAt: null,
                },
            ],
        });

        // 1. Dispara aviso de pausa em 24h sem linguagem técnica
        const res1 = await balancer.evaluateZeroBalanceAccounts(now);
        expect(res1).toEqual({ warned: 1, disconnected: 0 });
        expect(accounts[0].inactivityDisconnectAt).toBeTruthy();
        expect(sentPushes).toHaveLength(1);
        expect(savedNotifications).toHaveLength(1);

        const combinedCopy = `${savedNotifications[0].title} ${savedNotifications[0].message}`.toLowerCase();
        expect(combinedCopy).not.toContain('servidor windows');
        expect(combinedCopy).not.toContain('vps');
        expect(combinedCopy).not.toContain('login mt5');
        expect(combinedCopy).not.toContain('worker');

        // 2. Utilizador clica "Manter Sincronização Ativa" -> reseta prazo
        const keepRes = await balancer.keepAccountAlive('u1', 'acc-idle-1');
        expect(keepRes.success).toBe(true);
        expect(accounts[0].inactivityDisconnectAt).toBeNull();
        expect(accounts[0].inactivityWarnedAt).toBeNull();

        // 3. Caso volte a completar 7d + passar as 24h do aviso sem confirmação -> desconecta
        accounts[0].zeroBalanceSince = new Date(now - 8 * 86_400_000);
        accounts[0].inactivityWarnedAt = new Date(now - 25 * 3600_000);
        accounts[0].inactivityDisconnectAt = new Date(now - 1 * 3600_000);

        const res2 = await balancer.evaluateZeroBalanceAccounts(now);
        expect(res2).toEqual({ warned: 0, disconnected: 1 });
        expect(accounts[0].isConnected).toBe(false);
        expect(accounts[0].mt5SyncTier).toBe('COLD');
        expect(accounts[0].assignedWorkerId).toBeNull();
        expect(dispatchedTasks).toHaveLength(1);
        expect(dispatchedTasks[0][0]).toBe('STOP_ACCOUNT');
        expect(dispatchedTasks[0][5].targetWorkerId).toBe('vps-win-1');
    });

    it('rejects Keep-Alive from non-owner user and humanizes internal worker strings', async () => {
        const { balancer } = createBalancerHarness({
            accounts: [{ id: 'acc-1', userId: 'owner-user', isArchived: false }],
        });
        await expect(balancer.keepAccountAlive('other-user', 'acc-1')).rejects.toThrow(NotFoundException);

        const clean1 = humanizeClientSyncMessage('Worker Windows recebeu a tarefa no servidor Windows.');
        const clean2 = humanizeClientSyncMessage('Authorization failed (-6) para terminal64');
        expect(clean1.toLowerCase()).not.toContain('worker');
        expect(clean1.toLowerCase()).not.toContain('servidor windows');
        expect(clean2.toLowerCase()).not.toContain('terminal64');
        expect(clean2).toContain('autenticar na corretora');
    });

    it('returns anonymized MT5 telemetry in getClusterOverview without leaking PII, balances, or full logins', async () => {
        const { balancer } = createBalancerHarness({
            workers: [
                { workerId: 'vps-win-1', capacity: 10, isOnline: true, cpuPercent: 32, memoryPercent: 48 },
                { workerId: 'vps-win-2', capacity: 10, isOnline: true, cpuPercent: 18, memoryPercent: 35 },
            ],
            accounts: [
                {
                    id: '11111111-2222-3333-4444-555555555555',
                    userId: 'secret-user-99',
                    mt5Id: '987654321',
                    broker: 'MetaQuotes-Demo',
                    balance: 15432.89,
                    equity: 15600.12,
                    isConnected: true,
                    isArchived: false,
                    assignedWorkerId: 'vps-win-1',
                    mt5LeaseEpoch: 3,
                    mt5SyncTier: 'HOT',
                    zeroBalanceSince: null,
                    inactivityWarnedAt: null,
                    inactivityDisconnectAt: null,
                },
            ],
        });

        const overview = await balancer.getClusterOverview();
        expect(overview.totalTrackedAccounts).toBe(1);
        expect(overview.totalConnectedAccounts).toBe(1);
        expect(overview.accounts).toHaveLength(1);

        const row = overview.accounts[0];
        expect(row.accountMask).toBe('MT5 ••••4321');
        expect(row.accountName).toBe('Charlote Trader');
        expect(row.telemetryId).toHaveLength(8);
        expect(row.assignedWorkerId).toBe('vps-win-1');
        expect(row.leaseEpoch).toBe(3);
        expect(row.syncTier).toBe('HOT');

        expect(overview.correlations.onlineWorkersCount).toBe(2);
        expect(overview.correlations.unassignedCount).toBe(0);
        const w1 = overview.workers.find((w: any) => w.workerId === 'vps-win-1');
        expect(w1?.accountTags).toHaveLength(1);
        expect(w1?.accountTags[0].accountMask).toBe('MT5 ••••4321');
        expect(w1?.accountTags[0].accountName).toBe('Charlote Trader');

        const serialized = JSON.stringify(overview);
        expect(serialized).not.toContain('secret-user-99');
        expect(serialized).not.toContain('987654321');
        expect(serialized).not.toContain('15432');
        expect(serialized).not.toContain('15600');
        expect(serialized).not.toContain('MetaQuotes-Demo');
    });

    it('reconnects an MT5 account by telemetryId, decrypts v3 AAD password, clears quarantine, and dispatches START_ACCOUNT', async () => {
        const { CryptoUtil } = await import('../../common/utils/crypto.util');
        const { getMt5CredentialKeyring } = await import('../../common/security/security.config');

        const encryptedPass = CryptoUtil.encrypt(
            'MyBrokerSecret#99',
            getMt5CredentialKeyring(),
            { aad: 'mt5:u1:222707555' },
        );

        const { balancer, accounts, dispatchedTasks } = createBalancerHarness({
            workers: [
                { workerId: 'win-worker-01', capacity: 10, isOnline: true, cpuPercent: 25, memoryPercent: 60 },
            ],
            accounts: [
                {
                    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                    userId: 'u1',
                    name: 'Conta Exness Real',
                    mt5Id: '222707555',
                    broker: 'Exness-MT5Real30',
                    isConnected: false,
                    isArchived: false,
                    assignedWorkerId: 'win-worker-01',
                    mt5LeaseEpoch: 1,
                    mt5SyncTier: 'QUARANTINED',
                    mt5EncryptedPass: encryptedPass,
                    inactivityWarnedAt: new Date(),
                    inactivityDisconnectAt: new Date(),
                },
            ],
        });

        const overview = await balancer.getClusterOverview();
        const telemetryId = overview.accounts[0].telemetryId;
        expect(overview.accounts[0].accountName).toBe('Trader Alpha · Conta Exness Real');

        const res = await balancer.reconnectAccountByTelemetryId(telemetryId);
        expect(res.success).toBe(true);
        expect(res.telemetryId).toBe(telemetryId);
        expect(res.accountMask).toBe('MT5 ••••7555');
        expect(res.workerId).toBe('win-worker-01');
        expect(res.usedStoredCredentials).toBe(true);

        expect(accounts[0].mt5SyncTier).toBe('HOT');
        expect(accounts[0].inactivityDisconnectAt).toBeNull();
        expect(dispatchedTasks).toHaveLength(1);
        expect(dispatchedTasks[0][0]).toBe('START_ACCOUNT');
        expect(dispatchedTasks[0][1]).toBe('222707555');
        expect(dispatchedTasks[0][2]).toBe('Exness-MT5Real30');
        expect(dispatchedTasks[0][3]).toBe('MyBrokerSecret#99');
        expect(dispatchedTasks[0][5].adminTriggeredReconnect).toBe(true);
        expect(dispatchedTasks[0][5].priority).toBe(1);
    });

    it('silently fails over accounts from a DOWN worker to a healthy online worker and records Admin-only migration logs', async () => {
        const { CryptoUtil } = await import('../../common/utils/crypto.util');
        const { getMt5CredentialKeyring } = await import('../../common/security/security.config');

        const now = Date.now();
        const encryptedPass = CryptoUtil.encrypt(
            'AutoFailoverPass!2026',
            getMt5CredentialKeyring(),
            { aad: 'mt5:u1:444586125' },
        );

        const { balancer, accounts, dispatchedTasks } = createBalancerHarness({
            workers: [
                {
                    workerId: 'win-worker-01',
                    capacity: 10,
                    isOnline: false,
                    lastHeartbeat: new Date(now - 120_000), // Offline há 2 min (> 90s)
                },
                {
                    workerId: 'win-worker-02',
                    capacity: 10,
                    isOnline: true,
                    cpuPercent: 20,
                    memoryPercent: 45,
                    lastHeartbeat: new Date(now - 5_000),
                },
            ],
            accounts: [
                {
                    id: '1be1066d-954b-4a45-94ce-cb60eeb8ca3d',
                    userId: 'u1',
                    name: 'GoatFunded Phase 1',
                    mt5Id: '444586125',
                    broker: 'GoatFunded-Server2',
                    isConnected: true,
                    isArchived: false,
                    assignedWorkerId: 'win-worker-01',
                    mt5LeaseEpoch: 2,
                    mt5SyncTier: 'HOT',
                    mt5EncryptedPass: encryptedPass,
                },
            ],
        });

        const res = await balancer.evaluateDeadWorkerFailover(now);
        expect(res.migrated).toBe(1);

        // Conta foi movida para win-worker-02 mantendo isConnected=true e incrementando epoch
        expect(accounts[0].assignedWorkerId).toBe('win-worker-02');
        expect(accounts[0].isConnected).toBe(true);
        expect(accounts[0].mt5LeaseEpoch).toBe(3);

        // Tarefa START_ACCOUNT enviada com silentMigration=true + senha descriptografada
        expect(dispatchedTasks).toHaveLength(1);
        expect(dispatchedTasks[0][0]).toBe('START_ACCOUNT');
        expect(dispatchedTasks[0][1]).toBe('444586125');
        expect(dispatchedTasks[0][3]).toBe('AutoFailoverPass!2026');
        expect(dispatchedTasks[0][5].targetWorkerId).toBe('win-worker-02');
        expect(dispatchedTasks[0][5].silentMigration).toBe(true);
        expect(dispatchedTasks[0][5].migrationId).toBeTruthy();

        // Eviction enfileirada para o servidor antigo caso volte online
        expect(balancer.consumeEvictionsForWorker('win-worker-01')).toEqual(['444586125']);

        // Log exclusivo do Admin presente no overview e atualizado ao completar
        const overview1 = await balancer.getClusterOverview();
        expect(overview1.migrationLogs).toHaveLength(1);
        expect(overview1.migrationLogs[0].trigger).toBe('AUTO_FAILOVER');
        expect(overview1.migrationLogs[0].fromWorkerId).toBe('win-worker-01');
        expect(overview1.migrationLogs[0].toWorkerId).toBe('win-worker-02');
        expect(overview1.migrationLogs[0].status).toBe('IN_PROGRESS');

        await balancer.recordMigrationTaskOutcome(
            overview1.migrationLogs[0].id,
            'COMPLETED',
            'Login e reconciliação concluídos em win-worker-02.',
        );
        const overview2 = await balancer.getClusterOverview();
        expect(overview2.migrationLogs[0].status).toBe('COMPLETED');
        expect(overview2.migrationLogs[0].completedAt).toBeTruthy();
    });

    it('allows Admin 1-click manual server migration keeping user connection intact', async () => {
        const { CryptoUtil } = await import('../../common/utils/crypto.util');
        const { getMt5CredentialKeyring } = await import('../../common/security/security.config');

        const encryptedPass = CryptoUtil.encrypt(
            'ManualSwitchPass#1',
            getMt5CredentialKeyring(),
            { aad: 'mt5:u1:222707555' },
        );

        const { balancer, accounts, dispatchedTasks } = createBalancerHarness({
            workers: [
                { workerId: 'win-worker-01', capacity: 10, isOnline: true, cpuPercent: 40, memoryPercent: 60 },
                { workerId: 'win-worker-02', capacity: 10, isOnline: true, cpuPercent: 15, memoryPercent: 35 },
            ],
            accounts: [
                {
                    id: '22222222-3333-4444-5555-666666666666',
                    userId: 'u1',
                    name: 'Exness Real',
                    mt5Id: '222707555',
                    broker: 'Exness-MT5Real30',
                    isConnected: true,
                    isArchived: false,
                    assignedWorkerId: 'win-worker-01',
                    mt5LeaseEpoch: 1,
                    mt5SyncTier: 'HOT',
                    mt5EncryptedPass: encryptedPass,
                },
            ],
        });

        const overview = await balancer.getClusterOverview();
        const telemetryId = overview.accounts[0].telemetryId;

        const migrateRes = await balancer.migrateAccountByTelemetryId(telemetryId, 'win-worker-02');
        expect(migrateRes.success).toBe(true);
        expect(migrateRes.fromWorkerId).toBe('win-worker-01');
        expect(migrateRes.toWorkerId).toBe('win-worker-02');
        expect(accounts[0].assignedWorkerId).toBe('win-worker-02');
        expect(accounts[0].isConnected).toBe(true);
        expect(dispatchedTasks[0][5].silentMigration).toBe(true);

        const after = await balancer.getClusterOverview();
        expect(after.migrationLogs[0].trigger).toBe('MANUAL_ADMIN');
        expect(after.migrationLogs[0].toWorkerId).toBe('win-worker-02');
    });

    it('rejects reconnect with a concrete message when no workers are online and supports VPS-to-VPS migration diagnostics', async () => {
        const { balancer } = createBalancerHarness({
            workers: [{ workerId: 'win-worker-01', capacity: 10, isOnline: false }],
            accounts: [
                {
                    id: '33333333-4444-5555-6666-777777777777',
                    userId: 'u1',
                    name: 'Conta Offline',
                    mt5Id: '555666777',
                    broker: 'Exness-MT5Real30',
                    isConnected: false,
                    isArchived: false,
                    assignedWorkerId: 'win-worker-01',
                    mt5LeaseEpoch: 1,
                    mt5SyncTier: 'HOT',
                },
            ],
        });

        const overview = await balancer.getClusterOverview();
        const telemetryId = overview.accounts[0].telemetryId;

        await expect(balancer.reconnectAccountByTelemetryId(telemetryId)).rejects.toThrow(
            /Nenhum servidor worker MT5 está online/,
        );

        await expect(balancer.migrateWorkerAccounts('win-worker-01')).rejects.toThrow(
            /Nenhum outro servidor worker MT5 online saudável/,
        );
    });

    it('resolves user names reliably via ::text SQL join even when legacy non-UUID userIds exist and derives safe handle without leaking emails', async () => {
        const validUuidA = 'aaaaaaaa-1111-4222-8333-444444444444';
        const validUuidB = 'bbbbbbbb-1111-4222-8333-555555555555';
        const { balancer } = createBalancerHarness({
            workers: [{ workerId: 'win-worker-01', capacity: 10, isOnline: true }],
            accounts: [
                {
                    id: 'acc-uuid-a',
                    userId: validUuidA,
                    name: 'MT5 90014574',
                    mt5Id: '90014574',
                    broker: 'Exness-MT5Real',
                    isConnected: true,
                    isArchived: false,
                    assignedWorkerId: 'win-worker-01',
                    mt5LeaseEpoch: 1,
                    mt5SyncTier: 'HOT',
                },
                {
                    id: 'acc-uuid-b',
                    userId: validUuidB,
                    name: 'Conta Principal',
                    mt5Id: '90019999',
                    broker: 'Exness-MT5Real',
                    isConnected: true,
                    isArchived: false,
                    assignedWorkerId: 'win-worker-01',
                    mt5LeaseEpoch: 1,
                    mt5SyncTier: 'HOT',
                },
                {
                    id: 'acc-legacy-non-uuid',
                    userId: 'legacy-non-uuid-id',
                    name: 'Conta Prop Legacy',
                    mt5Id: '90018888',
                    broker: 'Exness-MT5Real',
                    isConnected: false,
                    isArchived: false,
                    assignedWorkerId: 'win-worker-01',
                    mt5LeaseEpoch: 1,
                    mt5SyncTier: 'COLD',
                },
            ],
        });

        // Simula o PostgreSQL retornando o JOIN u.id::text = TRIM(a.user_id)
        const repoManager = (balancer as any).accountRepo.manager;
        repoManager.query.mockImplementation(async (sql: string) => {
            if (sql.includes('INNER JOIN users u ON u.id::text')) {
                return [
                    {
                        account_id: 'acc-uuid-a',
                        user_id: validUuidA,
                        name: null,
                        username: null,
                        email: 'dercio.cossa@gmail.com',
                    },
                    {
                        account_id: 'acc-uuid-b',
                        user_id: validUuidB,
                        name: 'ana.mendes@outlook.com',
                        username: null,
                        email: 'ana.mendes@outlook.com',
                    },
                ];
            }
            return [];
        });

        const overview = await balancer.getClusterOverview();
        const rowA = overview.accounts.find((a) => a.accountMask === 'MT5 ••••4574');
        const rowB = overview.accounts.find((a) => a.accountMask === 'MT5 ••••9999');
        const rowLegacy = overview.accounts.find((a) => a.accountMask === 'MT5 ••••8888');

        expect(rowA?.ownerName).toBe('Dercio Cossa');
        expect(rowA?.accountName).toBe('Dercio Cossa');
        expect(rowB?.ownerName).toBe('Ana Mendes');
        expect(rowB?.accountName).toBe('Ana Mendes');
        expect(rowLegacy?.accountName).toBe('Conta Prop Legacy');

        const serialized = JSON.stringify(overview);
        expect(serialized).not.toContain('@');
        expect(serialized).not.toContain('gmail.com');
        expect(serialized).not.toContain('outlook.com');
        expect(serialized).not.toContain(validUuidA);
        expect(serialized).not.toContain('legacy-non-uuid-id');
    });
});
