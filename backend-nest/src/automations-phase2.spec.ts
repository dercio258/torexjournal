import { SubscriptionService } from './payment/subscription.service';
import { SubscriptionCycle, SubscriptionStatus } from './payment/subscription.entity';
import { PlanPermissionService } from './payment/plan-permission.service';
import { RiskManagementService } from './dashboard/risk-management.service';
import { EmailService } from './email/email.service';
import { renderEmailTemplate } from './email/templates';
import { AnalyticsService } from './analytics/analytics.service';
import { Mt5RedisSubscriber } from './mt5/mt5-redis-subscriber.service';

describe('Phase 2 Critical Automations, Billing & Consumer Fixes', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    function createSubscriptionServiceHarness() {
        const configService = {
            get: jest.fn().mockImplementation((key: string, def?: any) => {
                if (key === 'USD_TO_MZN_RATE') return 65;
                return def;
            }),
        };
        const alertsService = { create: jest.fn().mockResolvedValue({}) };
        const notificationsService = { create: jest.fn().mockResolvedValue({}) };
        const emailProducer = { enqueue: jest.fn().mockResolvedValue(true) };
        const planConfigRepo = {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest.fn(),
        };
        const subscriptionRepo = {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn().mockImplementation((x) => ({ id: 'new-sub-id', ...x })),
            save: jest.fn().mockImplementation(async (x) => x),
            manager: { transaction: jest.fn() },
        };
        const userRepo = {
            findOne: jest.fn(),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            manager: { transaction: jest.fn() },
        };
        const cacheManager = {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(undefined),
            del: jest.fn().mockResolvedValue(undefined),
        };
        const removedJobs: string[] = [];
        const subscriptionQueue = {
            add: jest.fn().mockResolvedValue({}),
            getJob: jest.fn().mockImplementation(async (id: string) => ({
                id,
                remove: jest.fn().mockImplementation(async () => {
                    removedJobs.push(id);
                }),
            })),
        };

        const service = new SubscriptionService(
            configService as any,
            alertsService as any,
            notificationsService as any,
            emailProducer as any,
            planConfigRepo as any,
            subscriptionRepo as any,
            userRepo as any,
            cacheManager as any,
            subscriptionQueue as any,
        );

        return {
            service,
            notificationsService,
            emailProducer,
            planConfigRepo,
            subscriptionRepo,
            userRepo,
            cacheManager,
            subscriptionQueue,
            removedJobs,
        };
    }

    it('converts USD plan pricing to MZN and executes renewSubscriptionById even at/past expiry without external gateway', async () => {
        const h = createSubscriptionServiceHarness();
        const planCfg = {
            id: 'plan-pro',
            tier: 'PRO',
            monthlyPrice: 19,
            annualDiscountPercent: 20,
            isActive: true,
        } as any;

        expect(h.service.getAmountUsd(planCfg, SubscriptionCycle.MONTHLY)).toBe(19);
        expect(h.service.getAmountMzn(planCfg, SubscriptionCycle.MONTHLY)).toBe(1235);
        expect(h.service.getAmountMzn(planCfg, SubscriptionCycle.YEARLY)).toBe(11856);

        const expiringSub = {
            id: 'sub-old-1',
            userId: 'user-1',
            status: SubscriptionStatus.ACTIVE,
            cycle: SubscriptionCycle.MONTHLY,
            currentPeriodEnd: new Date(Date.now() - 1000), // already at expiry timestamp
            planConfig: planCfg,
            user: {
                id: 'user-1',
                email: 'trader@torex.com',
                lastPaymentMethod: 'mpesa',
                preferredMpesa: '841234567',
            },
        };

        h.subscriptionRepo.findOne
            .mockResolvedValueOnce(expiringSub) // renewSubscriptionById sub load
            .mockResolvedValueOnce(null); // no newer active subscription
        h.planConfigRepo.findOne.mockResolvedValue(planCfg);
        h.userRepo.findOne.mockResolvedValue(expiringSub.user);

        const result = await h.service.renewSubscriptionById('sub-old-1');

        expect(result.action).toBe('renewal_initiated');
        expect(result.reference).toMatch(/^TOREX/);
        expect(h.subscriptionRepo.save).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'user-1',
                paymentMethod: 'mpesa',
                status: SubscriptionStatus.APPROVAL_PENDING,
                externalTransactionId: null,
            }),
        );
        expect(expiringSub.status).toBe(SubscriptionStatus.EXPIRED);
        expect(h.cacheManager.del).toHaveBeenCalledWith('user_plan_tier:user-1');
    });

    it('protects admin-extended subscriptions from stale renewal-charge jobs and reschedules instead of expiring', async () => {
        const h = createSubscriptionServiceHarness();
        const extendedExpiry = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
        const extendedSub = {
            id: 'sub-ext-1',
            userId: 'user-2',
            status: SubscriptionStatus.ACTIVE,
            cycle: SubscriptionCycle.MONTHLY,
            currentPeriodEnd: extendedExpiry,
            planConfig: { tier: 'PRO' },
        };
        h.subscriptionRepo.findOne.mockResolvedValueOnce(extendedSub);

        const result = await h.service.renewSubscriptionById('sub-ext-1');

        expect(result.action).toBe('rescheduled');
        expect(extendedSub.status).toBe(SubscriptionStatus.ACTIVE);
        expect(h.removedJobs).toContain('renewal-sched:sub-ext-1');
        expect(h.subscriptionQueue.add).toHaveBeenCalledWith(
            'renewal-charge',
            { subscriptionId: 'sub-ext-1' },
            expect.objectContaining({ jobId: 'renewal-sched:sub-ext-1' }),
        );
    });

    it('closes prior ACTIVE subscription on upgrade and revokes ACTIVE plan on refund/chargeback webhook', async () => {
        const h = createSubscriptionServiceHarness();
        const prevBasicSub = {
            id: 'sub-basic-prev',
            userId: 'user-upg',
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd: new Date(Date.now() + 10 * 24 * 3600_000),
        };
        const pendingProSub = {
            id: 'sub-pro-new',
            userId: 'user-upg',
            paymentReference: 'REF-PRO-1',
            externalTransactionId: 'ext-pro-1',
            status: SubscriptionStatus.APPROVAL_PENDING,
            cycle: SubscriptionCycle.MONTHLY,
            planConfig: { tier: 'PRO', monthlyPrice: 19, annualDiscountPercent: 20 },
        };

        h.subscriptionRepo.findOne.mockResolvedValueOnce(pendingProSub);
        h.subscriptionRepo.manager.transaction.mockImplementation(async (cb: any) => {
            const txManager = {
                findOne: jest.fn().mockResolvedValue({ ...pendingProSub }),
                find: jest.fn().mockResolvedValue([prevBasicSub]),
                save: jest.fn().mockImplementation(async (_e, row) => row),
            };
            return cb(txManager);
        });
        h.userRepo.findOne.mockResolvedValue({ id: 'user-upg', email: 'upg@torex.com' });

        await h.service.processPaymentWebhook({
            event: 'payment.completed',
            data: { reference: 'REF-PRO-1', payment_id: 'ext-pro-1' },
        });

        expect(prevBasicSub.status).toBe(SubscriptionStatus.CANCELLED);
        expect(h.removedJobs).toContain('renewal-sched:sub-basic-prev');
        expect(h.cacheManager.del).toHaveBeenCalledWith('user_plan_tier:user-upg');

        // Now test refund webhook on an ACTIVE subscription
        const activeSub = {
            id: 'sub-pro-new',
            userId: 'user-upg',
            paymentReference: 'REF-PRO-1',
            externalTransactionId: 'ext-pro-1',
            status: SubscriptionStatus.ACTIVE,
            planConfig: { tier: 'PRO' },
        };
        h.subscriptionRepo.findOne.mockResolvedValueOnce(activeSub);

        await h.service.processPaymentWebhook({
            event: 'payment.refunded',
            data: { reference: 'REF-PRO-1', payment_id: 'ext-pro-1' },
        });

        expect(activeSub.status).toBe(SubscriptionStatus.CANCELLED);
        expect(h.removedJobs).toContain('exp-warn-sched:sub-pro-new');
        expect(h.removedJobs).toContain('renewal-sched:sub-pro-new');
    });

    it('PlanPermissionService.getFullUserSubscription deterministically selects highest valid tier', async () => {
        const subRepo = {
            find: jest.fn().mockResolvedValue([
                {
                    id: 's-basic',
                    status: SubscriptionStatus.ACTIVE,
                    currentPeriodEnd: new Date(Date.now() + 20 * 86400_000),
                    planConfig: { tier: 'BASIC' },
                },
                {
                    id: 's-expired',
                    status: SubscriptionStatus.ACTIVE,
                    currentPeriodEnd: new Date(Date.now() - 1000),
                    planConfig: { tier: 'PREMIUM' },
                },
                {
                    id: 's-premium',
                    status: SubscriptionStatus.ACTIVE,
                    currentPeriodEnd: new Date(Date.now() + 5 * 86400_000),
                    planConfig: { tier: 'PREMIUM' },
                },
            ]),
        };
        const cacheManager = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
        const svc = new PlanPermissionService(subRepo as any, cacheManager as any);

        const picked = await svc.getFullUserSubscription('u-multi');
        expect(picked?.id).toBe('s-premium');
    });

    it('preserves M-Pesa, e-Mola, and Card checkout creation without external payment gateway', async () => {
        const h = createSubscriptionServiceHarness();
        const planCfg = {
            id: 'plan-pro',
            tier: 'PRO',
            monthlyPrice: 19,
            annualDiscountPercent: 20,
            isActive: true,
        } as any;
        h.planConfigRepo.findOne.mockResolvedValue(planCfg);
        h.userRepo.findOne.mockResolvedValue({
            id: 'u-pay',
            name: 'Trader One',
            email: 'pay@torex.com',
        });

        const emolaRes = await h.service.createMobileSubscription(
            'u-pay',
            'PRO',
            SubscriptionCycle.MONTHLY,
            'emola',
            '861234567',
            true,
        );
        expect(emolaRes).toEqual(
            expect.objectContaining({
                success: true,
                status: 'PENDING',
                paymentMethod: 'emola',
                currency: 'MZN',
                amount: 1235,
            }),
        );

        const cardRes = await h.service.createCardSubscription(
            'u-pay',
            'PRO',
            SubscriptionCycle.MONTHLY,
        );
        expect(cardRes).toEqual(
            expect.objectContaining({
                success: true,
                status: 'PENDING',
                paymentMethod: 'card',
                checkoutUrl: null,
                amountUsd: 19,
                amountMzn: 1235,
            }),
        );
    });

    it('renders all 8 payment & subscription billing email templates without status/category badges', () => {
        const forbiddenBadges = [
            'Aguardando Confirmação',
            'Assinatura Ativa',
            'Falha na Liquidação',
            'Período de Avaliação Ativo',
            'Renovação Programada',
            'Assinatura Expirada',
            'Cancelamento Registrado',
            'Solicitação em Aberto',
            '>Faturamento<',
            '>Assinatura<',
        ];

        const cases = [
            renderEmailTemplate('PAYMENT_INITIATED', {
                userName: 'Trader',
                amount: 1235,
                currency: 'MZN',
                method: 'mpesa',
                reference: 'REF-1',
                plan: 'PRO',
            }),
            renderEmailTemplate('PAYMENT_SUCCESS', {
                userName: 'Trader',
                plan: 'PRO',
                expiryDate: '2026-12-31T00:00:00.000Z',
                reference: 'REF-1',
            }),
            renderEmailTemplate('PAYMENT_FAILED', {
                userName: 'Trader',
                reference: 'REF-1',
                plan: 'PRO',
            }),
            renderEmailTemplate('TRIAL_WELCOME', {
                userName: 'Trader',
                days: 14,
                expiryDate: '2026-12-15T00:00:00.000Z',
                plan: 'PRO',
            }),
            renderEmailTemplate('SUBSCRIPTION_EXPIRING', {
                userName: 'Trader',
                plan: 'PRO',
                daysRemaining: 5,
                expiryDate: '2026-12-31T00:00:00.000Z',
            }),
            renderEmailTemplate('SUBSCRIPTION_EXPIRED', {
                userName: 'Trader',
                plan: 'PRO',
                expiredAt: '2026-12-31T00:00:00.000Z',
            }),
            renderEmailTemplate('SUBSCRIPTION_CANCELLED', {
                userName: 'Trader',
                plan: 'PRO',
                effectiveDate: '2026-12-31T00:00:00.000Z',
            }),
            renderEmailTemplate('REMARKETING_FOLLOWUP', {
                userName: 'Trader',
                plan: 'PRO',
            }),
        ];

        for (const rendered of cases) {
            for (const badge of forbiddenBadges) {
                expect(rendered.html).not.toContain(badge);
            }
            expect(rendered.html).not.toContain('border-radius: 4px; font-size: 11px; font-weight: 700;');
        }
    });

    it('RiskManagementService calculates daily loss via AccountEntity IDs and deduplicates alerts', async () => {
        const userRepo = {
            findOne: jest.fn().mockResolvedValue({
                id: 'u-risk',
                name: 'Trader',
                dailyLossLimit: 200,
                telegramChatId: 'tg-123',
            }),
        };
        const accountRepo = {
            find: jest.fn().mockResolvedValue([{ id: 'acc-r1' }]),
        };
        const tradeRepo = {
            find: jest.fn().mockResolvedValue([
                { profit: -150, commission: -5, swap: 0, netPnl: -155 },
                { profit: -90, commission: -5, swap: 0, netPnl: -95 },
            ]),
        };
        const notificationsService = { create: jest.fn().mockResolvedValue(undefined) };
        const seenKeys = new Set<string>();
        const redisSecurity = {
            setIfAbsent: jest.fn().mockImplementation(async (k: string) => {
                if (seenKeys.has(k)) return false;
                seenKeys.add(k);
                return true;
            }),
        };

        const riskSvc = new RiskManagementService(
            userRepo as any,
            tradeRepo as any,
            accountRepo as any,
            notificationsService as any,
            redisSecurity as any,
        );

        await riskSvc.checkDailyLossLimit({ userId: 'u-risk', trades: [] });
        await riskSvc.checkDailyLossLimit({ userId: 'u-risk', trades: [] }); // deduplicated

        expect(notificationsService.create).toHaveBeenCalledTimes(1);
    });

    it('skips email tracking pixel/link rewrite on security templates (OTP_CODE, PASSWORD_RECOVERY)', async () => {
        const mockDecorate = jest.fn().mockResolvedValue({ html: '<tracked/>', token: 'tok' });
        const emailSvc = new EmailService(
            { get: jest.fn() } as any,
            undefined,
            { createEmailTrackingTokenAndDecorateHtml: mockDecorate } as any,
        );

        await emailSvc.sendEmail(
            'sec@torex.com',
            'Reset Password',
            'Use link',
            '<a href="https://torex.com/reset?token=raw-secret">Reset</a>',
            { templateName: 'PASSWORD_RECOVERY' },
        );
        expect(mockDecorate).not.toHaveBeenCalled();

        await emailSvc.sendEmail(
            'news@torex.com',
            'Announcement',
            'News',
            '<a href="https://torex.com/news">Read</a>',
            { templateName: 'GENERAL_NOTIFICATION' },
        );
        expect(mockDecorate).toHaveBeenCalledTimes(1);

        // Also test AnalyticsService direct guard
        const analyticsSvc = new AnalyticsService(
            {} as any,
            {} as any,
            { findOne: jest.fn().mockResolvedValue({ enableEmailTracking: true }) } as any,
            {} as any,
            { get: jest.fn() } as any,
        );
        const untouched = await analyticsSvc.createEmailTrackingTokenAndDecorateHtml({
            to: 'u@torex.com',
            template: 'OTP_CODE',
            subject: 'Code',
            html: '<p>Code 654321</p>',
        });
        expect(untouched.token).toBeNull();
        expect(untouched.html).toBe('<p>Code 654321</p>');
    });

    it('Mt5RedisSubscriber propagates Bull enqueue failure so consume loop defers XACK', async () => {
        const sub = Object.create(Mt5RedisSubscriber.prototype) as Mt5RedisSubscriber;
        (sub as any).logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };
        (sub as any).mt5Queue = {
            add: jest.fn().mockRejectedValue(new Error('Redis queue down')),
        };

        await expect(
            (sub as any).processMessage(
                'stream:mt5_market_data',
                '1-0',
                JSON.stringify({ token: 'acc-tok', equity: 5000 }),
                {},
            ),
        ).rejects.toThrow('Redis queue down');

        // Poison pill malformed JSON returns safely so XACK can discard invalid entry
        await expect(
            (sub as any).processMessage('stream:mt5_market_data', '2-0', '{bad-json', {}),
        ).resolves.toBeUndefined();
    });
});
