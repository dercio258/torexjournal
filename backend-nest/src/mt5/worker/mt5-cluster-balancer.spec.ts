import { NotFoundException } from '@nestjs/common';
import { Mt5ClusterBalancerService, humanizeClientSyncMessage } from './mt5-cluster-balancer.service';
import { AccountType } from '../../account/account.entity';

describe('Mt5ClusterBalancerService (Pair-Stride K=2, Lifecycle & Humanized Notifications)', () => {
    function createBalancerHarness(options?: {
        accounts?: any[];
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

        const workersState: any[] = [];
        const mt5WorkerService: any = {
            getWorkerStatus: jest.fn(() => workersState),
            deriveNumericAccountId: jest.fn((login: string) => Number(login) || 1),
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
        expect(row.telemetryId).toHaveLength(8);
        expect(row.assignedWorkerId).toBe('vps-win-1');
        expect(row.leaseEpoch).toBe(3);
        expect(row.syncTier).toBe('HOT');

        const serialized = JSON.stringify(overview);
        expect(serialized).not.toContain('secret-user-99');
        expect(serialized).not.toContain('987654321');
        expect(serialized).not.toContain('15432');
        expect(serialized).not.toContain('15600');
        expect(serialized).not.toContain('MetaQuotes-Demo');
    });
});
