jest.mock('ioredis', () => {
    const MockRedis = jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        quit: jest.fn().mockResolvedValue('OK'),
        disconnect: jest.fn(),
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue('OK'),
        del: jest.fn().mockResolvedValue(1),
    }));
    (MockRedis as any).__esModule = true;
    (MockRedis as any).default = MockRedis;
    return MockRedis;
});

import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { createDecipheriv, createECDH, hkdfSync } from 'crypto';
import { isLoopbackRequest } from './security.config';
import {
    encryptJsonEnvelopeForClient,
    maskEmailAddress,
    maskPhoneNumber,
    maskSecretToken,
} from './payload-envelope.util';
import { OptionalJwtAuthGuard } from '../guards/optional-jwt-auth.guard';
import { Mt5TcpServer } from '../../mt5-tcp.server';
import {
    INVITE_AI_BONUS_DAYS,
    PLAN_CREDIT_MILESTONE_USD,
    ReferralService,
} from '../../users/referral.service';
import { NetworkService } from '../../network/network.service';
import { AiSemanticMemoryService } from '../../ai/ai-semantic-memory.service';
import { AiPrivacySanitizerService } from '../../ai/ai-privacy-sanitizer.service';
import { AiKnowledgeBaseService } from '../../ai/ai-knowledge-base.service';
import { SubscriptionService } from '../../payment/subscription.service';
import { PlanGuard } from '../../payment/plan.guard';
import { PlanTier } from '../../payment/plan-permission.service';
import { WeeklyReportService } from '../../dashboard/weekly-report.service';
import { TorexAiChatService } from '../../ai/torex-ai-chat.service';
import { AI_SUPPORT_FALLBACK_MESSAGE } from '../../ai/ai-credits.entity';

describe('Phase 4 Security, Brokers, Privacy & Affiliate Rules', () => {
    describe('isLoopbackRequest', () => {
        it('rejects spoofed Host: localhost when socket IP is public', () => {
            const spoofedReq = {
                headers: { host: 'localhost:3000', 'x-forwarded-for': '127.0.0.1' },
                socket: { remoteAddress: '203.0.113.55' },
                ip: '203.0.113.55',
            };
            expect(isLoopbackRequest(spoofedReq)).toBe(false);
        });

        it('accepts genuine loopback addresses', () => {
            expect(isLoopbackRequest({ socket: { remoteAddress: '127.0.0.1' } })).toBe(true);
            expect(isLoopbackRequest({ socket: { remoteAddress: '::1' } })).toBe(true);
            expect(isLoopbackRequest({ socket: { remoteAddress: '::ffff:127.0.0.1' } })).toBe(true);
        });
    });

    describe('OptionalJwtAuthGuard', () => {
        function makeContext(token: string): { ctx: ExecutionContext; req: any } {
            const req: any = {
                headers: { authorization: `Bearer ${token}` },
            };
            const ctx = {
                switchToHttp: () => ({
                    getRequest: () => req,
                }),
            } as unknown as ExecutionContext;
            return { ctx, req };
        }

        it('clears req.user when session is revoked or user is blocked', async () => {
            const jwtService: any = {
                verifyAsync: jest.fn().mockResolvedValue({ id: 'u-1', role: 'user' }),
            };
            const configService: any = {
                get: jest.fn().mockReturnValue('test-jwt-secret'),
            };
            const dataSourceRevoked: any = {
                query: jest.fn().mockImplementation(async (sql: string) => {
                    if (/FROM "sessions"/i.test(sql)) {
                        return [{ id: 's-1', isActive: false, expiresAt: new Date(Date.now() + 60_000) }];
                    }
                    return [];
                }),
            };

            const guardRevoked = new OptionalJwtAuthGuard(jwtService, configService, undefined, dataSourceRevoked);
            const c1 = makeContext('tok-revoked');
            await expect(guardRevoked.canActivate(c1.ctx)).resolves.toBe(true);
            expect(c1.req.user).toBeNull();

            const dataSourceBlocked: any = {
                query: jest.fn().mockImplementation(async (sql: string) => {
                    if (/FROM "sessions"/i.test(sql)) {
                        return [{ id: 's-2', isActive: true, expiresAt: new Date(Date.now() + 60_000) }];
                    }
                    if (/FROM "users"/i.test(sql)) {
                        return [{ is_blocked: true }];
                    }
                    return [];
                }),
            };
            const guardBlocked = new OptionalJwtAuthGuard(jwtService, configService, undefined, dataSourceBlocked);
            const c2 = makeContext('tok-blocked');
            await expect(guardBlocked.canActivate(c2.ctx)).resolves.toBe(true);
            expect(c2.req.user).toBeNull();
        });

        it('attaches req.user when session is active and user is not blocked', async () => {
            const payload = { id: 'u-2', role: 'user' };
            const jwtService: any = { verifyAsync: jest.fn().mockResolvedValue(payload) };
            const configService: any = { get: jest.fn().mockReturnValue('test-jwt-secret') };
            const dataSource: any = {
                query: jest.fn().mockImplementation(async (sql: string) => {
                    if (/FROM "sessions"/i.test(sql)) {
                        return [{ id: 's-3', isActive: true, expiresAt: new Date(Date.now() + 60_000) }];
                    }
                    if (/FROM "users"/i.test(sql)) {
                        return [{ is_blocked: false }];
                    }
                    return [];
                }),
            };
            const guard = new OptionalJwtAuthGuard(jwtService, configService, undefined, dataSource);
            const { ctx, req } = makeContext('tok-valid');
            await expect(guard.canActivate(ctx)).resolves.toBe(true);
            expect(req.user).toEqual(payload);
        });
    });

    describe('Mt5TcpServer secondary routing index', () => {
        it('routes sendCommand by account.id (UUID) and mt5Id via accountToSocketId index', async () => {
            const configService: any = { get: jest.fn((_k: string, def?: any) => def) };
            const mt5Service: any = {
                validateAppToken: jest.fn().mockResolvedValue({
                    id: 'acc-uuid-555',
                    userId: 'user-1',
                    mt5Id: '776655',
                }),
                updateHeartbeat: jest.fn().mockResolvedValue(undefined),
            };
            const server = new Mt5TcpServer(configService, mt5Service);
            const socketMock: any = {
                remoteAddress: '127.0.0.1',
                remotePort: 50001,
                destroyed: false,
                write: jest.fn(),
            };
            const socketId = '127.0.0.1:50001';
            const session: any = { socket: socketMock, authenticated: false };
            (server as any).clients.set(socketId, session);

            await (server as any).validateClient(session, 'valid-app-token');

            expect(server.sendCommand('acc-uuid-555', 1, 'SYNC')).toBe(true);
            expect(server.sendCommand('776655', 2, 'PING')).toBe(true);
            expect(server.sendCommand('unknown-acc', 1, 'NOOP')).toBe(false);
            // 1 auth ack + 2 dispatched commands
            expect(socketMock.write).toHaveBeenCalledTimes(3);
        });
    });

    describe('ReferralService affiliate rewards & anti-fraud pending hold', () => {
        function createReferralHarness(options: { verifiedCountBefore: number; hasPaidPlan: boolean }) {
            const userState: Record<string, any> = {
                'ref-1': {
                    id: 'ref-1',
                    email: 'affiliate@torex.com',
                    referralCode: 'TRXAFF1',
                    referralCreditsUsd: 0,
                    referralPendingCreditsUsd: 0,
                    referralAiBonusUntil: null,
                    referralTierBoost: false,
                },
                'new-1': {
                    id: 'new-1',
                    email: 'friend@torex.com',
                    referredByUserId: null,
                },
            };

            const referralRepo: any = {
                findOne: jest.fn().mockResolvedValue(null),
                count: jest.fn().mockImplementation(async (args: any) => {
                    if (args?.where?.createdAt) return 0;
                    return options.verifiedCountBefore;
                }),
                create: jest.fn((data: any) => ({ ...data })),
                save: jest.fn(async (row: any) => row),
            };

            const userRepo: any = {
                findOne: jest.fn().mockImplementation(async (args: any) => {
                    if (args?.where?.referralCode === 'TRXAFF1') return userState['ref-1'];
                    if (args?.where?.id) return userState[args.where.id] || null;
                    return null;
                }),
                update: jest.fn().mockImplementation(async (where: any, patch: any) => {
                    if (where?.id && userState[where.id]) {
                        Object.assign(userState[where.id], patch);
                    }
                }),
                manager: {
                    query: jest.fn().mockImplementation(async (sql: string) => {
                        if (/FROM "subscriptions"/i.test(sql)) {
                            return options.hasPaidPlan ? [{ id: 'sub-paid-1' }] : [];
                        }
                        return [];
                    }),
                },
            };

            const service = new ReferralService(referralRepo, userRepo);
            return { service, userState };
        }

        it('does not unlock AI bonus or milestone credit on signup alone; approves only on paid conversion', async () => {
            const { service, userState } = createReferralHarness({
                verifiedCountBefore: 0,
                hasPaidPlan: false,
            });
            const res = await service.processVerifiedSignup('new-1', 'TRXAFF1');

            expect(res.attributed).toBe(true);
            expect(res.aiDailyBonusUnlocked).toBe(false);
            expect(res.creditedUsd).toBe(0);
            expect(res.pendingCreditsAddedUsd).toBe(0);
            expect(userState['ref-1'].referralAiBonusUntil).toBeNull();
        });

        it('unlocks +50 daily AI bonus and holds $10 in pending on 3rd paid invite when referrer has no paid plan, then unlocks on paid activation', async () => {
            const paidRows: any[] = [
                { id: 'r-p-1', status: 'PAID' },
                { id: 'r-p-2', status: 'PAID' },
                { id: 'r-reg-3', referrerUserId: 'ref-1', referredUserId: 'new-3', status: 'REGISTERED' },
            ];
            const userState: Record<string, any> = {
                'ref-1': {
                    id: 'ref-1',
                    email: 'ref@torex.com',
                    referralCode: 'TRXAFF1',
                    referralCreditsUsd: 0,
                    referralPendingCreditsUsd: 0,
                    referralAiBonusUntil: null,
                    referralTierBoost: false,
                },
            };
            const referralRepo: any = {
                findOne: jest.fn().mockImplementation(async (args: any) => {
                    if (args?.where?.referredUserId === 'new-3') return paidRows[2];
                    return null;
                }),
                count: jest.fn().mockResolvedValue(2),
                save: jest.fn().mockImplementation(async (obj: any) => obj),
            };
            const userRepo: any = {
                findOne: jest.fn().mockImplementation(async (args: any) => userState[args?.where?.id] || null),
                update: jest.fn().mockImplementation(async (where: any, patch: any) => {
                    if (where?.id && userState[where.id]) {
                        Object.assign(userState[where.id], patch);
                    }
                }),
                manager: {
                    query: jest.fn().mockResolvedValue([]),
                },
            };

            const service = new ReferralService(referralRepo, userRepo);
            const before = Date.now();
            const conv = await service.processPaidConversion('new-3');

            expect(conv.awarded).toBe(true);
            expect(conv.creditedUsd).toBe(0);
            expect(conv.pendingCreditsAddedUsd).toBe(PLAN_CREDIT_MILESTONE_USD);
            expect(userState['ref-1'].referralCreditsUsd).toBe(0);
            expect(userState['ref-1'].referralPendingCreditsUsd).toBe(PLAN_CREDIT_MILESTONE_USD);
            expect(new Date(userState['ref-1'].referralAiBonusUntil).getTime()).toBeGreaterThanOrEqual(
                before + (INVITE_AI_BONUS_DAYS - 1) * 86_400_000,
            );

            const unlock = await service.unlockPendingCreditsOnPaidPlan('ref-1');
            expect(unlock.unlockedUsd).toBe(PLAN_CREDIT_MILESTONE_USD);
            expect(userState['ref-1'].referralCreditsUsd).toBe(PLAN_CREDIT_MILESTONE_USD);
            expect(userState['ref-1'].referralPendingCreditsUsd).toBe(0);
        });

        it('credits $10 immediately on 3rd paid referral when referrer already holds a paid plan and gates getMySummary outside trial context', async () => {
            const regRow = { id: 'r-reg-3', referrerUserId: 'ref-1', referredUserId: 'new-3', status: 'REGISTERED' };
            const userState: Record<string, any> = {
                'ref-1': {
                    id: 'ref-1',
                    email: 'ref@torex.com',
                    username: 'reftrader',
                    referralCode: 'TRXAFF1',
                    referralCreditsUsd: 0,
                    referralPendingCreditsUsd: 0,
                    referralAiBonusUntil: null,
                    referralTierBoost: false,
                },
            };
            let hasPaid = false;
            const referralRepo: any = {
                findOne: jest.fn().mockResolvedValue(regRow),
                find: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(2),
                save: jest.fn().mockImplementation(async (obj: any) => obj),
            };
            const userRepo: any = {
                findOne: jest.fn().mockImplementation(async (args: any) => userState[args?.where?.id] || null),
                update: jest.fn().mockImplementation(async (where: any, patch: any) => {
                    if (where?.id && userState[where.id]) {
                        Object.assign(userState[where.id], patch);
                    }
                }),
                manager: {
                    query: jest.fn().mockImplementation(async (sql: string) => {
                        if (/FROM "subscriptions"/i.test(sql)) {
                            return hasPaid ? [{ id: 'sub-paid-1' }] : [];
                        }
                        return [];
                    }),
                },
            };

            const service = new ReferralService(referralRepo, userRepo);

            // Unpaid user in non-trial context -> affiliate NOT approved & link hidden
            const unpaidSummary = await service.getMySummary('ref-1');
            expect(unpaidSummary.affiliateApproved).toBe(false);
            expect(unpaidSummary.shareUrl).toBe('');

            // Unpaid user in trial pricing context -> approved to complete share gate
            const trialContextSummary = await service.getMySummary('ref-1', 'trial');
            expect(trialContextSummary.affiliateApproved).toBe(true);
            expect(trialContextSummary.shareUrl).toContain('ref=TRXAFF1');

            // Once paid -> affiliate approved & $10 granted immediately on 3rd paid conversion
            hasPaid = true;
            const paidSummary = await service.getMySummary('ref-1');
            expect(paidSummary.affiliateApproved).toBe(true);

            const conv = await service.processPaidConversion('new-3');
            expect(conv.creditedUsd).toBe(PLAN_CREDIT_MILESTONE_USD);
            expect(conv.pendingCreditsAddedUsd).toBe(0);
            expect(userState['ref-1'].referralCreditsUsd).toBe(PLAN_CREDIT_MILESTONE_USD);
        });
    });

    describe('NetworkService private post guard & AiSemanticMemoryService GLOBAL_SAFE quorum', () => {
        it('forbids non-author interactions on private community posts', async () => {
            const postRepo: any = {
                findOne: jest.fn().mockResolvedValue({
                    id: 42,
                    userId: 'author-1',
                    visibility: 'private',
                    likesCount: 0,
                }),
            };
            const noopRepo: any = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
            const gw: any = { broadcastNewPost: jest.fn(), getOnlineUserIds: jest.fn(() => []) };
            const service = new NetworkService(
                postRepo,
                noopRepo,
                noopRepo,
                noopRepo,
                noopRepo,
                noopRepo,
                noopRepo,
                gw,
            );

            await expect(service.toggleLike('intruder-user', 42)).rejects.toThrow(ForbiddenException);
        });

        it('protects GLOBAL_SAFE memory from single -1 vote quarantine until quorum >= 2', async () => {
            let dbRow: any = {
                id: 'mem-global-1',
                scope_level: 'GLOBAL_SAFE',
                owner_scope: '__GLOBAL__',
                user_id: null,
                account_id: null,
                locale: 'pt',
                domain_category: 'PLATFORM_KNOWLEDGE',
                sub_intent: 'guide',
                intent_key: 'guide:csv',
                canonical_question: 'como exportar csv',
                normalized_question: 'como exportar csv',
                cached_reply: 'Clique em CSV.',
                action_links: [],
                handoff_template: null,
                positive_count: 5,
                negative_count: 0,
                distinct_positive_users: 5,
                trust_score: 0.9,
                hit_count: 10,
                llm_tokens_saved: 500,
                status: 'ACTIVE',
                created_at: new Date(),
                updated_at: new Date(),
            };

            const dataSource: any = {
                query: jest.fn().mockImplementation(async (sql: string, params: any[] = []) => {
                    if (/SELECT \* FROM ai_semantic_memory WHERE id = \$1/i.test(sql)) {
                        return [{ ...dbRow }];
                    }
                    if (/UPDATE ai_semantic_memory/i.test(sql) && /SET negative_count/i.test(sql)) {
                        dbRow = {
                            ...dbRow,
                            negative_count: params[0],
                            trust_score: params[1],
                            status: params[2],
                        };
                        return [];
                    }
                    return [];
                }),
            };

            const kb = new AiKnowledgeBaseService();
            const sanitizer = new AiPrivacySanitizerService();
            const service = new AiSemanticMemoryService(dataSource, kb, sanitizer);

            // Vote #1 -> must stay ACTIVE even with forceQuarantine
            await service.applyNegativeFeedbackToMemory('mem-global-1', undefined, 'pt', {
                forceQuarantine: true,
            });
            expect(dbRow.negative_count).toBe(1);
            expect(dbRow.status).toBe('ACTIVE');

            // Vote #2 -> quorum reached, now QUARANTINED
            await service.applyNegativeFeedbackToMemory('mem-global-1', undefined, 'pt', {
                forceQuarantine: true,
            });
            expect(dbRow.negative_count).toBe(2);
            expect(dbRow.status).toBe('QUARANTINED');
        });
    });

    describe('Tiered Trials (30d BASIC / 14d PRO / 7d PREMIUM) Once-Ever & PlanGuard Zero-Data Gate', () => {
        function createSubscriptionTrialHarness(options: { hasUsedTrial: boolean; subscriptionCount: number; isBlocked?: boolean }) {
            const userRecord: any = {
                id: 'u-trial-1',
                email: 'trader@torex.com',
                name: 'Trader',
                hasUsedTrial: options.hasUsedTrial,
                trialUsedAt: null,
                isBlocked: Boolean(options.isBlocked),
            };
            const savedSubs: any[] = [];
            let subCount = options.subscriptionCount;

            const manager: any = {
                findOne: jest.fn().mockImplementation(async (entity: any, opts?: any) => {
                    if (entity?.name === 'UserEntity') return userRecord;
                    if (entity?.name === 'SubscriptionPlanConfig') {
                        const requestedTier = String(opts?.where?.tier || 'BASIC').toUpperCase();
                        return { id: `plan-${requestedTier.toLowerCase()}-1`, tier: requestedTier, isActive: true };
                    }
                    return null;
                }),
                count: jest.fn().mockImplementation(async () => subCount),
                create: jest.fn((_entity: any, data: any) => ({ ...data })),
                save: jest.fn().mockImplementation(async (entity: any, obj: any) => {
                    if (entity?.name === 'Subscription') {
                        const created = { id: `sub-${savedSubs.length + 1}`, ...obj };
                        savedSubs.push(created);
                        subCount += 1;
                        return created;
                    }
                    return obj;
                }),
            };

            const userRepo: any = {
                findOne: jest.fn().mockResolvedValue(userRecord),
                manager: {
                    transaction: jest.fn(async (cb: any) => cb(manager)),
                },
            };
            const subscriptionRepo: any = {
                count: jest.fn().mockImplementation(async () => subCount),
            };
            const planConfigRepo: any = { findOne: jest.fn() };
            const configService: any = { get: jest.fn((_k: string, d?: any) => d) };
            const alertsService: any = {};
            const notificationsService: any = {};
            const emailProducer: any = { enqueue: jest.fn().mockResolvedValue(undefined) };
            const cacheManager: any = {
                get: jest.fn().mockResolvedValue(null),
                set: jest.fn().mockResolvedValue(undefined),
                del: jest.fn().mockResolvedValue(undefined),
            };
            const queue: any = { add: jest.fn().mockResolvedValue({}), getJobs: jest.fn().mockResolvedValue([]) };

            const service = new SubscriptionService(
                configService,
                alertsService,
                notificationsService,
                emailProducer,
                planConfigRepo,
                subscriptionRepo,
                userRepo,
                cacheManager,
                queue,
            );

            return { service, userRecord, savedSubs };
        }

        it('isEligibleForBasicTrial returns true ONLY when hasUsedTrial=false and subscriptionCount=0', async () => {
            const eligible = createSubscriptionTrialHarness({ hasUsedTrial: false, subscriptionCount: 0 });
            await expect(eligible.service.isEligibleForBasicTrial('u-trial-1')).resolves.toBe(true);

            const usedFlag = createSubscriptionTrialHarness({ hasUsedTrial: true, subscriptionCount: 0 });
            await expect(usedFlag.service.isEligibleForBasicTrial('u-trial-1')).resolves.toBe(false);

            const hadPriorSub = createSubscriptionTrialHarness({ hasUsedTrial: false, subscriptionCount: 1 });
            await expect(hadPriorSub.service.isEligibleForBasicTrial('u-trial-1')).resolves.toBe(false);
        });

        it('activateTrial grants 30d BASIC, 14d PRO, and 7d PREMIUM once per account and rejects a second attempt', async () => {
            const basicHarness = createSubscriptionTrialHarness({
                hasUsedTrial: false,
                subscriptionCount: 0,
            });
            const basicRes = await basicHarness.service.activateTrial('u-trial-1', 'BASIC');
            expect(basicRes.success).toBe(true);
            expect(basicRes.tier).toBe('BASIC');
            expect(basicRes.trialDays).toBe(30);
            expect(basicHarness.userRecord.hasUsedTrial).toBe(true);
            expect(basicHarness.savedSubs).toHaveLength(1);
            expect(basicHarness.savedSubs[0].paymentMethod).toBe('TRIAL');
            await expect(basicHarness.service.activateTrial('u-trial-1', 'PRO')).rejects.toThrow(ForbiddenException);

            const proHarness = createSubscriptionTrialHarness({
                hasUsedTrial: false,
                subscriptionCount: 0,
            });
            const proRes = await proHarness.service.activateTrial('u-trial-1', 'PRO');
            expect(proRes.tier).toBe('PRO');
            expect(proRes.trialDays).toBe(14);
            await expect(proHarness.service.activateBasicTrial('u-trial-1')).rejects.toThrow(ForbiddenException);

            const premHarness = createSubscriptionTrialHarness({
                hasUsedTrial: false,
                subscriptionCount: 0,
            });
            const premRes = await premHarness.service.activateTrial('u-trial-1', 'PREMIUM');
            expect(premRes.tier).toBe('PREMIUM');
            expect(premRes.trialDays).toBe(7);
        });

        it('activateTrial enforces 30s affiliate share cooldown when verifyShareGate=true', async () => {
            const { service } = createSubscriptionTrialHarness({
                hasUsedTrial: false,
                subscriptionCount: 0,
            });

            // Rejects without prior share intent
            await expect(
                service.activateTrial('u-trial-1', 'PRO', { verifyShareGate: true }),
            ).rejects.toThrow(BadRequestException);

            const nowSpy = jest.spyOn(Date, 'now');
            try {
                const startMs = 1_700_000_000_000;
                nowSpy.mockReturnValue(startMs);
                await service.recordTrialShareIntent('u-trial-1', 'PRO', 'whatsapp');

                // Rejects when less than 28s have elapsed
                nowSpy.mockReturnValue(startMs + 10_000);
                await expect(
                    service.activateTrial('u-trial-1', 'PRO', { verifyShareGate: true }),
                ).rejects.toThrow(BadRequestException);

                // Succeeds after 30s cooldown passes
                nowSpy.mockReturnValue(startMs + 31_000);
                const activated = await service.activateTrial('u-trial-1', 'PRO', {
                    verifyShareGate: true,
                });
                expect(activated.success).toBe(true);
                expect(activated.tier).toBe('PRO');
                expect(activated.trialDays).toBe(14);
            } finally {
                nowSpy.mockRestore();
            }
        });

        it('PlanGuard denies PlanTier.FREE with SUBSCRIPTION_REQUIRED ForbiddenException', async () => {
            const reflector: any = {
                getAllAndOverride: jest.fn().mockReturnValue(PlanTier.BASIC),
            };
            const planPermissionService: any = {
                getUserPlan: jest.fn().mockResolvedValue(PlanTier.FREE),
                checkPermission: jest.fn().mockResolvedValue(false),
            };
            const guard = new PlanGuard(reflector, planPermissionService);
            const ctx: any = {
                getHandler: () => ({}),
                getClass: () => ({}),
                switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u-free-1' } }) }),
            };

            let caught: any;
            try {
                await guard.canActivate(ctx);
            } catch (err) {
                caught = err;
            }
            expect(caught).toBeInstanceOf(ForbiddenException);
            expect(caught.getResponse()).toMatchObject({
                statusCode: 403,
                code: 'SUBSCRIPTION_REQUIRED',
            });
        });
    });

    describe('Payload Envelope Crypto & PII Masking', () => {
        it('masks email addresses, phone numbers, and EA secret tokens without leaking raw PII', () => {
            expect(maskEmailAddress('derciomatsope9@gmail.com')).toBe('de***9@gmail.com');
            expect(maskEmailAddress('ab@torex.com')).toBe('a***@torex.com');
            expect(maskPhoneNumber('+258 843357697')).toBe('+258 •••• 7697');
            expect(maskPhoneNumber('')).toBeNull();
            expect(maskSecretToken('F3A462E0-BD61-4E5A-A343-2538F18F7A9F')).toBe(
                '••••••••••••••••••••7A9F',
            );
        });

        it('encrypts API JSON payload with ephemeral ECDH P-256 + HKDF-SHA256 + AES-256-GCM and rejects tampering', () => {
            jest.useRealTimers();
            const clientEcdh = createECDH('prime256v1');
            const rawClientPub = clientEcdh.generateKeys();
            const clientPubB64Url = rawClientPub.toString('base64url');

            const sensitivePayload = JSON.stringify({
                id: '50f4649c-5380-4e2b-b2eb-b62feeb37466',
                email: 'de***9@gmail.com',
                token: 'F3A462E0-SECRET-TOKEN',
            });

            const wireEnvelopeStr = encryptJsonEnvelopeForClient(sensitivePayload, clientPubB64Url);
            expect(wireEnvelopeStr).toBeTruthy();
            expect(wireEnvelopeStr).not.toContain('50f4649c');
            expect(wireEnvelopeStr).not.toContain('dercio');
            expect(wireEnvelopeStr).not.toContain('F3A462E0');

            const env = JSON.parse(wireEnvelopeStr!);
            expect(env._enc).toBe('ecdh-p256-aes256gcm-v1');

            const epkBytes = Buffer.from(env.epk, 'base64url');
            const ivBytes = Buffer.from(env.iv, 'base64url');
            const tagBytes = Buffer.from(env.tag, 'base64url');
            const ctBytes = Buffer.from(env.ct, 'base64url');

            const sharedSecret = clientEcdh.computeSecret(epkBytes);
            const aesKey = Buffer.from(
                hkdfSync('sha256', sharedSecret, ivBytes, Buffer.from('torex-envelope-v1', 'utf8'), 32),
            );
            const aad = Buffer.concat([epkBytes, rawClientPub, ivBytes]);

            const decipher = createDecipheriv('aes-256-gcm', aesKey, ivBytes);
            decipher.setAAD(aad);
            decipher.setAuthTag(tagBytes);
            const decryptedStr = Buffer.concat([decipher.update(ctBytes), decipher.final()]).toString('utf8');
            expect(JSON.parse(decryptedStr)).toEqual(JSON.parse(sensitivePayload));

            // Tampering with authentication tag must fail AES-GCM verification
            const tamperedTag = Buffer.from(tagBytes);
            tamperedTag[0] ^= 0xff;
            const badDecipher = createDecipheriv('aes-256-gcm', aesKey, ivBytes);
            badDecipher.setAAD(aad);
            badDecipher.setAuthTag(tamperedTag);
            expect(() => {
                badDecipher.update(ctBytes);
                badDecipher.final();
            }).toThrow();
        });
    });

    describe('Tiered Email Report Delivery & Pre-Flight AI Credits Gate', () => {
        it('enforces BASIC website-only, PRO monthly email, and PREMIUM weekly email report permissions', async () => {
            const users = [
                { id: 'u-basic', email: 'basic@torex.com', name: 'Basic' },
                { id: 'u-pro', email: 'pro@torex.com', name: 'Pro' },
                { id: 'u-prem', email: 'prem@torex.com', name: 'Prem' },
            ];
            const tierByUser: Record<string, PlanTier> = {
                'u-basic': PlanTier.BASIC,
                'u-pro': PlanTier.PRO,
                'u-prem': PlanTier.PREMIUM,
            };

            const enqueuedBulk: any[] = [];
            const enqueuedSingle: any[] = [];
            const service = new WeeklyReportService(
                {
                    find: jest.fn().mockResolvedValue(users),
                    findOne: jest.fn(async ({ where }: any) => users.find((u) => u.id === where?.id) || null),
                } as any,
                { findOne: jest.fn().mockResolvedValue({ currency: 'USD' }) } as any,
                {
                    getWeeklySummary: jest.fn().mockResolvedValue({
                        totalPnL: 120,
                        winRate: 60,
                        totalTrades: 5,
                        topLessons: [],
                        period: { start: '2026-11-14T00:00:00.000Z', end: '2026-11-21T00:00:00.000Z' },
                    }),
                    getMonthlySummary: jest.fn().mockResolvedValue({
                        totalPnL: 450,
                        winRate: 62,
                        totalTrades: 18,
                        topLessons: [],
                        period: { start: '2026-10-22T00:00:00.000Z', end: '2026-11-21T00:00:00.000Z' },
                    }),
                } as any,
                {
                    enqueueBulk: jest.fn(async (items: any[]) => {
                        enqueuedBulk.push(...items);
                        return items.length;
                    }),
                    enqueue: jest.fn(async (to: string, template: string, data: any) => {
                        enqueuedSingle.push({ to, template, data });
                        return true;
                    }),
                } as any,
                undefined,
                {
                    getUserPlan: jest.fn(async (uid: string) => tierByUser[uid] || PlanTier.FREE),
                } as any,
            );

            await service.handleWeeklyReport();
            await service.handleMonthlyReport();

            expect(enqueuedBulk).toEqual([
                expect.objectContaining({ to: 'prem@torex.com', template: 'WEEKLY_SUMMARY' }),
                expect.objectContaining({ to: 'pro@torex.com', template: 'MONTHLY_SUMMARY' }),
            ]);

            await expect(service.sendReportEmailOnDemand('u-basic', 'MONTHLY')).rejects.toThrow(
                ForbiddenException,
            );
            await expect(service.sendReportEmailOnDemand('u-pro', 'WEEKLY')).rejects.toThrow(
                ForbiddenException,
            );

            const proMonthlyRes = await service.sendReportEmailOnDemand('u-pro', 'MONTHLY');
            expect(proMonthlyRes).toEqual({ success: true, frequency: 'MONTHLY', tier: PlanTier.PRO });

            const premWeeklyRes = await service.sendReportEmailOnDemand('u-prem', 'WEEKLY');
            expect(premWeeklyRes).toEqual({ success: true, frequency: 'WEEKLY', tier: PlanTier.PREMIUM });
            expect(enqueuedSingle.map((e) => `${e.to}:${e.template}`)).toEqual([
                'pro@torex.com:MONTHLY_SUMMARY',
                'prem@torex.com:WEEKLY_SUMMARY',
            ]);
        });

        it('blocks zero-credit AI prompts upfront with 403 ForbiddenException before persisting session/message or fallback', async () => {
            const sessionSaveMock = jest.fn();
            const messageSaveMock = jest.fn();
            const jobSaveMock = jest.fn();

            const chatService = new TorexAiChatService(
                { query: jest.fn() } as any,
                { findOne: jest.fn(), create: jest.fn((d: any) => d), save: sessionSaveMock } as any,
                { create: jest.fn((d: any) => d), save: messageSaveMock } as any,
                { findOne: jest.fn(), create: jest.fn((d: any) => d), save: jobSaveMock } as any,
                {} as any,
                {} as any,
                {} as any,
                {
                    assertCanInteract: jest.fn().mockRejectedValue(
                        new ForbiddenException({
                            statusCode: 403,
                            code: 'INSUFFICIENT_AI_CREDITS',
                            message: 'Você não possui créditos AI disponíveis.',
                        }),
                    ),
                } as any,
                { inspectAndClassifyInput: jest.fn() } as any,
                {} as any,
            );

            let caught: any;
            try {
                await chatService.enqueueMessage({
                    userId: 'u-zero',
                    userName: 'Zero',
                    question: 'Qual é minha melhor sessão?',
                });
            } catch (err) {
                caught = err;
            }

            expect(caught).toBeInstanceOf(ForbiddenException);
            expect(caught.getResponse()).toMatchObject({
                statusCode: 403,
                code: 'INSUFFICIENT_AI_CREDITS',
            });
            expect(caught.getResponse().message).not.toBe(AI_SUPPORT_FALLBACK_MESSAGE);
            expect(sessionSaveMock).not.toHaveBeenCalled();
            expect(messageSaveMock).not.toHaveBeenCalled();
            expect(jobSaveMock).not.toHaveBeenCalled();
        });
    });
});
