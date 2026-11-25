import { ForbiddenException } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import {
    AI_DAILY_CREDITS_BY_TIER,
    PlanTier,
} from './plan-permission.service';
import {
    AccountService,
    BASIC_PLAN_MAX_ACTIVE_TRADING_ACCOUNTS,
} from '../account/account.service';
import { AccountType } from '../account/account.entity';

describe('Subscription plans catalog, Basic credits & 3-account cap', () => {
    it('seedDefaultPlans deactivates duplicate $9/$10 Basic plan and keeps $2.99 Basic with 100 credits & 3 accounts', async () => {
        const storedPlans: any[] = [
            {
                id: 'legacy-basic-10',
                tier: 'BASIC',
                monthlyPrice: 10,
                compareAtPrice: 10,
                usdToMznRate: 74,
                monthlyDiscountPercent: 20,
                quarterlyDiscountPercent: 5,
                annualDiscountPercent: 25,
                biennialDiscountPercent: 29,
                maxTradingAccounts: 1,
                monthlyBacktestsLimit: 0,
                aiDailyCredits: 100,
                isActive: true,
                description: 'Para quem está começando no trading',
                features: ['1 Conta de Trading ativa', '100 Créditos AI / mês'],
                createdAt: new Date('2026-01-01T00:00:00Z'),
            },
            {
                id: 'canonical-basic-299',
                tier: 'BASIC',
                monthlyPrice: 2.99,
                compareAtPrice: 2.99,
                usdToMznRate: 74,
                monthlyDiscountPercent: 20,
                quarterlyDiscountPercent: 5,
                annualDiscountPercent: 25,
                biennialDiscountPercent: 29,
                maxTradingAccounts: 1,
                monthlyBacktestsLimit: 0,
                aiDailyCredits: 0,
                isActive: true,
                description: 'Para quem está começando no trading',
                features: [
                    '1 Conta de Trading ativa',
                    '0 Créditos AI / mês',
                    'Relatórios operacionais no site (visualizar e baixar)',
                ],
                createdAt: new Date('2026-02-01T00:00:00Z'),
            },
            {
                id: 'pro-row',
                tier: 'PRO',
                monthlyPrice: 19.99,
                compareAtPrice: 19.99,
                usdToMznRate: 74,
                monthlyDiscountPercent: 20,
                quarterlyDiscountPercent: 9,
                annualDiscountPercent: 35,
                biennialDiscountPercent: 44,
                maxTradingAccounts: -1,
                monthlyBacktestsLimit: 10,
                aiDailyCredits: 1500,
                isActive: true,
                description: 'Para traders ativos e consistentes',
                features: ['Modo Offline (exceto Trade Replay)'],
                createdAt: new Date('2026-02-01T00:00:00Z'),
            },
            {
                id: 'premium-row',
                tier: 'PREMIUM',
                monthlyPrice: 39.99,
                compareAtPrice: 39.99,
                usdToMznRate: 74,
                monthlyDiscountPercent: 20,
                quarterlyDiscountPercent: 19,
                annualDiscountPercent: 49,
                biennialDiscountPercent: 51,
                maxTradingAccounts: -1,
                monthlyBacktestsLimit: 100,
                aiDailyCredits: 4000,
                isActive: true,
                description: 'Performance máxima com IA e backteste avançado',
                features: ['100 Automated Backtesting Runs / month'],
                createdAt: new Date('2026-02-01T00:00:00Z'),
            },
        ];

        const planConfigRepo: any = {
            find: jest.fn().mockImplementation(async (opts?: any) => {
                if (opts?.where?.isActive === true) {
                    return storedPlans.filter((p) => p.isActive);
                }
                return [...storedPlans];
            }),
            save: jest.fn().mockImplementation(async (entity: any) => {
                const idx = storedPlans.findIndex((p) => p.id && p.id === entity.id);
                if (idx >= 0) {
                    storedPlans[idx] = { ...storedPlans[idx], ...entity };
                    return storedPlans[idx];
                }
                const created = { id: `new-${storedPlans.length + 1}`, ...entity };
                storedPlans.push(created);
                return created;
            }),
        };

        const service = new SubscriptionService(
            { get: jest.fn((_k: string, d?: any) => d) } as any,
            {} as any,
            {} as any,
            { enqueue: jest.fn() } as any,
            planConfigRepo,
            { find: jest.fn() } as any,
            { findOne: jest.fn() } as any,
            { get: jest.fn(), set: jest.fn(), del: jest.fn() } as any,
            { add: jest.fn(), getJobs: jest.fn() } as any,
        );

        await service.seedDefaultPlans();
        const activePlans = await service.getActivePlans();

        expect(activePlans.map((p) => p.tier)).toEqual(['BASIC', 'PRO', 'PREMIUM']);
        const legacyRow = storedPlans.find((p) => p.id === 'legacy-basic-10');
        expect(legacyRow?.isActive).toBe(false);

        const [basic, pro, premium] = activePlans;
        expect(basic.monthlyPrice).toBe(2.99);
        expect(basic.aiDailyCredits).toBe(100);
        expect(basic.maxTradingAccounts).toBe(3);
        expect(basic.features).toContain('3 Contas de Trading ativas');
        expect(basic.features).toContain('100 Créditos AI / mês');
        expect(basic.features).toContain('Relatórios operacionais completos');
        expect(basic.features.join(' ')).not.toContain('visualizar e baixar');

        expect(pro.features).toContain('AI Coach');
        expect(pro.features).toContain('Relatórios mensais');
        expect(pro.features).toContain('Modo Offline');
        expect(pro.features.join(' ')).not.toContain('exceto Trade Replay');
        expect(pro.features.join(' ')).not.toContain('Torex AI');

        expect(premium.features).toContain('AI Coach');
        expect(premium.features).toContain('Relatórios semanais');
        expect(premium.features).toContain('Modo Offline completo');
        expect(premium.features.join(' ')).not.toContain('Automated Backtesting');
        expect(premium.features.join(' ')).not.toContain('Torex AI');

        expect(AI_DAILY_CREDITS_BY_TIER[PlanTier.BASIC]).toBe(100);
    });

    it('AccountService enforces up to 3 active trading accounts on BASIC tier', async () => {
        expect(BASIC_PLAN_MAX_ACTIVE_TRADING_ACCOUNTS).toBe(3);

        let activeCount = 0;
        const accountRepo: any = {
            count: jest.fn().mockImplementation(async () => activeCount),
            create: jest.fn((data: any) => ({ ...data })),
            save: jest.fn().mockImplementation(async (data: any) => ({
                id: `acc-${activeCount + 1}`,
                ...data,
            })),
        };

        const accountService = new AccountService(
            accountRepo,
            { create: jest.fn(), save: jest.fn() } as any,
            {} as any,
            {} as any,
            {} as any,
            { get: jest.fn(), set: jest.fn(), del: jest.fn() } as any,
            { getUserPlan: jest.fn().mockResolvedValue(PlanTier.BASIC) } as any,
        );

        for (let i = 0; i < 3; i++) {
            const created = await accountService.createAccount('user-basic-1', {
                name: `Conta ${i + 1}`,
                broker: 'IC Markets',
                type: AccountType.LIVE,
                currency: 'USD',
            });
            expect(created.name).toBe(`Conta ${i + 1}`);
            activeCount += 1;
        }

        await expect(
            accountService.createAccount('user-basic-1', {
                name: 'Conta 4',
                broker: 'IC Markets',
                type: AccountType.LIVE,
                currency: 'USD',
            }),
        ).rejects.toThrow(ForbiddenException);
    });

    it('getActiveCryptoPayment returns canonical $2.99 BASIC plan instead of inactive legacy $10 row', async () => {
        const storedPlans = [
            {
                id: 'legacy-basic-10',
                tier: 'BASIC',
                monthlyPrice: 10,
                annualDiscountPercent: 20,
                isActive: false,
            },
            {
                id: 'canonical-basic-299',
                tier: 'BASIC',
                monthlyPrice: 2.99,
                annualDiscountPercent: 25,
                isActive: true,
            },
        ];

        const planConfigRepo: any = {
            find: jest.fn().mockImplementation(async (opts?: any) => {
                const clauses = Array.isArray(opts?.where) ? opts.where : opts?.where ? [opts.where] : [{}];
                return storedPlans.filter((row) =>
                    clauses.some((clause: any) =>
                        Object.entries(clause).every(([k, v]) => (row as any)[k] === v),
                    ),
                );
            }),
        };

        const cryptoSessionRepo: any = {
            findOne: jest.fn().mockResolvedValue({
                id: 'sess-1',
                userId: 'user-1',
                subscriptionId: 'sub-1',
                paymentReference: 'TOREX2026TEST',
                providerPaymentId: 'np-123',
                tier: 'BASIC',
                cycle: 'YEARLY',
                fiatAmountUsd: 26.88,
                fiatCurrency: 'USD',
                cryptoCurrency: 'BNB.BSC',
                payCurrencyCode: 'bnbbsc',
                displayName: 'Binance Coin',
                network: 'BSC',
                walletAddress: '0xabc',
                cryptoAmount: '0.04809595',
                qrCodeDataUrl: 'data:image/png;base64,test',
                providerStatus: 'waiting',
                expiresAt: new Date(Date.now() + 30 * 60 * 1000),
            }),
        };

        const subRepo: any = {
            findOne: jest.fn().mockResolvedValue({
                id: 'sub-1',
                userId: 'user-1',
                status: 'APPROVAL_PENDING',
            }),
        };

        const nowPaymentsService: any = {
            isConfirmedPaidStatus: jest.fn().mockReturnValue(false),
            isFailedOrExpiredStatus: jest.fn().mockReturnValue(false),
            generateSlipSignature: jest.fn().mockReturnValue('sig-123'),
        };

        const service = new SubscriptionService(
            { get: jest.fn((_k: string, d?: any) => d) } as any,
            {} as any,
            {} as any,
            { enqueue: jest.fn() } as any,
            planConfigRepo,
            subRepo,
            { findOne: jest.fn() } as any,
            { get: jest.fn().mockResolvedValue('cached'), set: jest.fn(), del: jest.fn() } as any,
            { add: jest.fn(), getJobs: jest.fn() } as any,
            undefined,
            undefined,
            cryptoSessionRepo,
            nowPaymentsService,
        );

        const active = await service.getActiveCryptoPayment('user-1');
        expect(active.active).toBe(true);
        expect(active.plan?.id).toBe('canonical-basic-299');
        expect(active.plan?.monthlyPrice).toBe(2.99);
        expect(active.plan?.annualDiscountPercent).toBe(25);
        expect(service.getAmountUsd(active.plan as any, 'YEARLY' as any)).toBe(26.88);
    });
});
