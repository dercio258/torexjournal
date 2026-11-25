import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { SubscriptionCycle, SubscriptionStatus } from './subscription.entity';
import { RenewalInvoiceStatus } from './subscription-renewal-invoice.entity';

describe('SubscriptionService payment webhooks, smart status caching & callbacks', () => {
    const createHarness = (opts: {
        subscriptions?: any[];
        invoices?: any[];
        plans?: any[];
        debitoCheckStatus?: jest.Mock;
    } = {}) => {
        const cacheStore = new Map<string, any>();
        const cacheManager: any = {
            get: jest.fn(async (key: string) => cacheStore.get(key)),
            set: jest.fn(async (key: string, val: any) => {
                cacheStore.set(key, val);
            }),
            del: jest.fn(async (key: string) => {
                cacheStore.delete(key);
            }),
        };

        const subs = opts.subscriptions || [];
        const invoices = opts.invoices || [];
        const plans = opts.plans || [
            {
                id: 'plan-pro',
                tier: 'PRO',
                monthlyPrice: 19.99,
                annualDiscountPercent: 35,
                usdToMznRate: 74,
                isActive: true,
            },
        ];

        const matchWhere = (row: any, where: any): boolean => {
            if (!where) return true;
            const list = Array.isArray(where) ? where : [where];
            return list.some((clause) =>
                Object.entries(clause).every(([k, v]) => row[k] === v),
            );
        };

        const subscriptionRepo: any = {
            findOne: jest.fn(async ({ where }: any) => {
                return subs.find((s) => matchWhere(s, where)) || null;
            }),
            find: jest.fn(async ({ where }: any) => {
                return subs.filter((s) => matchWhere(s, where));
            }),
            save: jest.fn(async (entity: any) => {
                const idx = subs.findIndex((s) => s.id === entity.id);
                if (idx >= 0) subs[idx] = entity;
                else subs.push(entity);
                return entity;
            }),
            manager: {
                transaction: jest.fn(async (cb: any) => {
                    const txManager = {
                        findOne: jest.fn(async (cls: any, { where }: any) => {
                            if (cls.name === 'Subscription') {
                                return subs.find((s) => matchWhere(s, where)) || null;
                            }
                            return null;
                        }),
                        find: jest.fn(async (cls: any, { where }: any) => {
                            if (cls.name === 'Subscription') {
                                return subs.filter(
                                    (s) =>
                                        s.userId === where.userId &&
                                        s.id !== where.id?._value &&
                                        ['ACTIVE', 'APPROVAL_PENDING', 'APPROVED'].includes(s.status),
                                );
                            }
                            if (cls.name === 'SubscriptionRenewalInvoice') {
                                return invoices.filter((inv) => matchWhere(inv, where));
                            }
                            return [];
                        }),
                        save: jest.fn(async (cls: any, entity: any) => {
                            if (cls.name === 'SubscriptionRenewalInvoice') {
                                const idx = invoices.findIndex((i) => i.id === entity.id);
                                if (idx >= 0) invoices[idx] = entity;
                                return entity;
                            }
                            const idx = subs.findIndex((s) => s.id === entity.id);
                            if (idx >= 0) subs[idx] = entity;
                            return entity;
                        }),
                    };
                    return cb(txManager);
                }),
            },
        };

        const renewalInvoiceRepo: any = {
            findOne: jest.fn(async ({ where }: any) => {
                return invoices.find((i) => matchWhere(i, where)) || null;
            }),
            save: jest.fn(async (entity: any) => entity),
        };

        const planConfigRepo: any = {
            find: jest.fn(async () => plans),
            findOne: jest.fn(async () => plans[0] || null),
        };

        const userRepo: any = {
            findOne: jest.fn(async ({ where }: any) => ({
                id: where.id || 'user-1',
                email: 'trader@example.com',
                name: 'Trader One',
            })),
        };

        const emailProducer: any = {
            enqueue: jest.fn(async () => true),
        };
        const alertsService: any = { create: jest.fn(async () => undefined) };
        const notificationsService: any = { create: jest.fn(async () => undefined) };
        const subscriptionQueue: any = {
            add: jest.fn(async () => undefined),
            getJob: jest.fn(async () => null),
        };
        const debitoPayService: any = {
            checkStatus: opts.debitoCheckStatus || jest.fn(async () => null),
        };
        const configService = {
            get: jest.fn((key: string) => {
                if (key === 'FRONTEND_URL') return 'https://torexjournal.com';
                return undefined;
            }),
        } as unknown as ConfigService;

        const service = new SubscriptionService(
            configService,
            alertsService,
            notificationsService,
            emailProducer,
            planConfigRepo,
            subscriptionRepo,
            userRepo,
            cacheManager,
            subscriptionQueue,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            debitoPayService,
            renewalInvoiceRepo,
        );

        return {
            service,
            subs,
            invoices,
            cacheStore,
            cacheManager,
            emailProducer,
            notificationsService,
            subscriptionQueue,
            debitoPayService,
        };
    };

    it('activates subscription and enqueues PAYMENT_SUCCESS email for Debito Pay success/paid/settled/payment.completed webhooks', async () => {
        const sub = {
            id: 'sub-1',
            userId: 'user-1',
            planConfigId: 'plan-pro',
            planConfig: { id: 'plan-pro', tier: 'PRO', monthlyPrice: 19.99, annualDiscountPercent: 35 },
            paymentReference: 'TOREX-REF-1',
            externalTransactionId: 'dp-pay-1',
            status: SubscriptionStatus.APPROVAL_PENDING,
            cycle: SubscriptionCycle.MONTHLY,
            paymentMethod: 'mpesa',
            createdAt: new Date(),
        };
        const inv = {
            id: 'inv-1',
            token: 'a'.repeat(64),
            userId: 'user-1',
            tier: 'PRO',
            cycle: 'MONTHLY',
            status: RenewalInvoiceStatus.PENDING,
            paymentReference: 'TOREX-REF-1',
        };

        const h = createHarness({ subscriptions: [sub], invoices: [inv] });

        expect(h.service.classifyWebhookStatus('success')).toBe('success');
        expect(h.service.classifyWebhookStatus('paid')).toBe('success');
        expect(h.service.classifyWebhookStatus('settled')).toBe('success');
        expect(h.service.classifyWebhookStatus('PAYMENT.COMPLETED')).toBe('success');
        expect(h.service.classifyWebhookStatus('payment.expired')).toBe('expired');
        expect(h.service.classifyWebhookStatus('payment.failed')).toBe('failed');

        await h.service.processPaymentWebhook({
            data: {
                payment_id: 'dp-pay-1',
                source_id: 'TOREX-REF-1',
                status: 'success',
            },
        });

        expect(sub.status).toBe(SubscriptionStatus.ACTIVE);
        expect(inv.status).toBe(RenewalInvoiceStatus.PAID);
        expect(h.emailProducer.enqueue).toHaveBeenCalledWith(
            'trader@example.com',
            'PAYMENT_SUCCESS',
            expect.objectContaining({
                plan: 'PRO',
                reference: 'TOREX-REF-1',
            }),
            { jobId: 'payment-success:sub-1' },
        );
    });

    it('marks subscription EXPIRED and sends PAYMENT_FAILED email on expiration webhook', async () => {
        const sub = {
            id: 'sub-exp',
            userId: 'user-1',
            planConfigId: 'plan-pro',
            planConfig: { id: 'plan-pro', tier: 'PRO', monthlyPrice: 19.99 },
            paymentReference: 'TOREX-EXP-1',
            externalTransactionId: 'dp-exp-1',
            status: SubscriptionStatus.APPROVAL_PENDING,
            cycle: SubscriptionCycle.MONTHLY,
            paymentMethod: 'emola',
            createdAt: new Date(),
        };

        const h = createHarness({ subscriptions: [sub] });
        await h.service.processPaymentWebhook({
            event: 'payment.expired',
            data: { payment_id: 'dp-exp-1', reference: 'TOREX-EXP-1' },
        });

        expect(sub.status).toBe(SubscriptionStatus.EXPIRED);
        expect(h.emailProducer.enqueue).toHaveBeenCalledWith(
            'trader@example.com',
            'PAYMENT_FAILED',
            expect.objectContaining({ reference: 'TOREX-EXP-1' }),
            { jobId: 'payment-failed:sub-exp' },
        );
    });

    it('coalesces concurrent checkPaymentStatus calls and caches terminal outcome with smart polling delays', async () => {
        const sub = {
            id: 'sub-poll',
            userId: 'user-1',
            planConfigId: 'plan-pro',
            planConfig: { id: 'plan-pro', tier: 'PRO', monthlyPrice: 19.99 },
            paymentReference: 'TOREX-POLL-1',
            externalTransactionId: 'dp-poll-1',
            status: SubscriptionStatus.APPROVAL_PENDING,
            cycle: SubscriptionCycle.MONTHLY,
            paymentMethod: 'mpesa',
            createdAt: new Date(),
        };

        let resolveRemote!: (val: any) => void;
        const debitoCheckStatus = jest.fn(
            () =>
                new Promise((resolve) => {
                    resolveRemote = resolve;
                }),
        );

        const h = createHarness({ subscriptions: [sub], debitoCheckStatus });

        // Launch 4 concurrent passive checks — should trigger only 1 remote Debito Pay call
        const p1 = h.service.checkPaymentStatus('TOREX-POLL-1', 'user-1');
        const p2 = h.service.checkPaymentStatus('TOREX-POLL-1', 'user-1');
        const p3 = h.service.checkPaymentStatus('TOREX-POLL-1', 'user-1');
        const p4 = h.service.checkPaymentStatus('TOREX-POLL-1', 'user-1');

        await new Promise((r) => setTimeout(r, 15));
        expect(debitoCheckStatus).toHaveBeenCalledTimes(1);

        resolveRemote({
            paymentId: 'dp-poll-1',
            status: 'pending',
            rawStatus: 'pending',
            reference: 'TOREX-POLL-1',
            amount: 1479,
            currency: 'MZN',
            rawResponse: {},
        });

        const [r1, r2] = await Promise.all([p1, p2, p3, p4]);
        expect(r1.status).toBe(SubscriptionStatus.APPROVAL_PENDING);
        expect(r2.nextPollAfterMs).toBe(3500);

        // Passive check immediately afterwards uses Redis cooldown (0 extra Debito calls)
        await h.service.checkPaymentStatus('TOREX-POLL-1', 'user-1', { forceRemote: false });
        expect(debitoCheckStatus).toHaveBeenCalledTimes(1);

        // Wrong owner rejected cleanly
        await expect(
            h.service.checkPaymentStatus('TOREX-POLL-1', 'other-user'),
        ).rejects.toThrow(ForbiddenException);

        // Once settled as ACTIVE, terminal cache avoids subsequent remote calls and returns nextPollAfterMs=0
        debitoCheckStatus.mockResolvedValueOnce({
            paymentId: 'dp-poll-1',
            status: 'success',
            rawStatus: 'success',
            reference: 'TOREX-POLL-1',
            amount: 1479,
            currency: 'MZN',
            rawResponse: {},
        });
        const settled = await h.service.checkPaymentStatus('TOREX-POLL-1', 'user-1', {
            forceRemote: true,
        });
        expect(settled.status).toBe(SubscriptionStatus.ACTIVE);
        expect(settled.nextPollAfterMs).toBe(0);
    });

    it('redirects callback success -> /subscription/success and failed/cancelled -> /checkout with modal query params', async () => {
        const subFailed = {
            id: 'sub-fail',
            userId: 'user-1',
            planConfigId: 'plan-pro',
            planConfig: { id: 'plan-pro', tier: 'PRO', monthlyPrice: 19.99 },
            paymentReference: 'TOREX-FAIL-1',
            externalTransactionId: 'dp-fail-1',
            status: SubscriptionStatus.CANCELLED,
            cycle: SubscriptionCycle.YEARLY,
            paymentMethod: 'card',
            createdAt: new Date(),
        };
        const subActive = {
            id: 'sub-ok',
            userId: 'user-1',
            planConfigId: 'plan-pro',
            planConfig: { id: 'plan-pro', tier: 'PRO', monthlyPrice: 19.99 },
            paymentReference: 'TOREX-OK-1',
            externalTransactionId: 'dp-ok-1',
            status: SubscriptionStatus.ACTIVE,
            cycle: SubscriptionCycle.MONTHLY,
            paymentMethod: 'payfast',
            createdAt: new Date(),
        };
        const renewalToken = 'b'.repeat(64);
        const subRenewalFail = {
            id: 'sub-ren-fail',
            userId: 'user-2',
            planConfigId: 'plan-pro',
            planConfig: { id: 'plan-pro', tier: 'PRO', monthlyPrice: 19.99 },
            paymentReference: 'TOREX-REN-FAIL',
            externalTransactionId: 'dp-ren-fail',
            status: SubscriptionStatus.CANCELLED,
            cycle: SubscriptionCycle.MONTHLY,
            paymentMethod: 'card',
            createdAt: new Date(),
        };
        const renewalInvoice = {
            id: 'inv-ren',
            token: renewalToken,
            userId: 'user-2',
            tier: 'PRO',
            cycle: 'MONTHLY',
            status: RenewalInvoiceStatus.PENDING,
            paymentReference: 'TOREX-REN-FAIL',
            paymentMethod: 'card',
        };

        const h = createHarness({
            subscriptions: [subFailed, subActive, subRenewalFail],
            invoices: [renewalInvoice],
        });

        const failedUrl = await h.service.resolvePaymentCallbackRedirect('failed', {
            reference: 'TOREX-FAIL-1',
            method: 'card',
            status: 'failed',
        });
        expect(failedUrl).toContain('https://torexjournal.com/checkout?');
        expect(failedUrl).toContain('payment_status=failed');
        expect(failedUrl).toContain('tier=PRO');
        expect(failedUrl).toContain('cycle=YEARLY');
        expect(failedUrl).toContain('method=card');

        // Even if /failed endpoint is hit, if gateway/DB confirms ACTIVE, redirect safely to /subscription/success
        const rescuedUrl = await h.service.resolvePaymentCallbackRedirect('failed', {
            reference: 'TOREX-OK-1',
            method: 'payfast',
        });
        expect(rescuedUrl).toContain('https://torexjournal.com/subscription/success?');
        expect(rescuedUrl).toContain('payment_status=active');

        // Renewal failed callback redirects back to public /subscription/payment/:token instead of /checkout
        const renFailedUrl = await h.service.resolvePaymentCallbackRedirect('failed', {
            reference: 'TOREX-REN-FAIL',
            method: 'card',
        });
        expect(renFailedUrl).toContain(`/subscription/payment/${renewalToken}?`);
        expect(renFailedUrl).toContain('payment_status=failed');
    });
});
