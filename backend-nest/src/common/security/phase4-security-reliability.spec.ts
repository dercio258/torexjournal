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

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { isLoopbackRequest } from './security.config';
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

        it('awards +50 daily AI credits for 30 days on first verified invite', async () => {
            const { service, userState } = createReferralHarness({
                verifiedCountBefore: 0,
                hasPaidPlan: false,
            });
            const before = Date.now();
            const res = await service.processVerifiedSignup('new-1', 'TRXAFF1');

            expect(res.attributed).toBe(true);
            expect(res.aiDailyBonusUnlocked).toBe(true);
            expect(res.creditedUsd).toBe(0);
            expect(res.pendingCreditsAddedUsd).toBe(0);
            const untilMs = new Date(userState['ref-1'].referralAiBonusUntil).getTime();
            expect(untilMs).toBeGreaterThanOrEqual(before + (INVITE_AI_BONUS_DAYS - 1) * 86_400_000);
        });

        it('holds $10 plan credit in pending when free affiliate reaches 3 invites, then unlocks on paid activation', async () => {
            const { service, userState } = createReferralHarness({
                verifiedCountBefore: 2,
                hasPaidPlan: false,
            });

            const res = await service.processVerifiedSignup('new-1', 'TRXAFF1');
            expect(res.creditedUsd).toBe(0);
            expect(res.pendingCreditsAddedUsd).toBe(PLAN_CREDIT_MILESTONE_USD);
            expect(userState['ref-1'].referralCreditsUsd).toBe(0);
            expect(userState['ref-1'].referralPendingCreditsUsd).toBe(PLAN_CREDIT_MILESTONE_USD);

            const unlock = await service.unlockPendingCreditsOnPaidPlan('ref-1');
            expect(unlock.unlockedUsd).toBe(PLAN_CREDIT_MILESTONE_USD);
            expect(userState['ref-1'].referralCreditsUsd).toBe(PLAN_CREDIT_MILESTONE_USD);
            expect(userState['ref-1'].referralPendingCreditsUsd).toBe(0);
        });

        it('credits $10 immediately when affiliate already holds a paid plan', async () => {
            const { service, userState } = createReferralHarness({
                verifiedCountBefore: 2,
                hasPaidPlan: true,
            });

            const res = await service.processVerifiedSignup('new-1', 'TRXAFF1');
            expect(res.creditedUsd).toBe(PLAN_CREDIT_MILESTONE_USD);
            expect(res.pendingCreditsAddedUsd).toBe(0);
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
});
