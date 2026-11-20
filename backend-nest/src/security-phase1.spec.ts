import {
    BadRequestException,
    ExecutionContext,
    ForbiddenException,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
    OAUTH_STATE_COOKIE_NAME,
    buildClearOAuthStateCookieHeader,
    generateOAuthState,
    verifyOAuthState,
} from './auth/oauth-state.util';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { PlanGuard, REQUIRE_PLAN_KEY } from './payment/plan.guard';
import {
    PlanGuard as CommonPlanGuard,
    REQUIRE_PLAN_KEY as COMMON_REQUIRE_PLAN_KEY,
} from './common/guards/plan.guard';
import { PlanTier } from './payment/plan-permission.service';
import { Mt5WorkerService, WorkerTaskType } from './mt5/worker/mt5-worker.service';
import { AccountType } from './account/account.entity';
import { NetworkAcademyService } from './network/video-lesson.service';

describe('Phase 1 Security Hardening (Backend)', () => {
    const prevJwtSecret = process.env.JWT_SECRET;

    beforeAll(() => {
        process.env.JWT_SECRET = 'phase1-test-jwt-secret-min-32-chars!!';
    });

    afterAll(() => {
        if (prevJwtSecret === undefined) {
            delete process.env.JWT_SECRET;
        } else {
            process.env.JWT_SECRET = prevJwtSecret;
        }
    });

    it('OAuth state generation & verification enforces HMAC, TTL, and cookie binding', () => {
        const secret = 'oauth-hmac-secret-phase1';
        const { state, setCookieHeader } = generateOAuthState(secret, true);

        expect(setCookieHeader).toContain(`${OAUTH_STATE_COOKIE_NAME}=${state}`);
        expect(setCookieHeader).toContain('HttpOnly');
        expect(setCookieHeader).toContain('Secure');

        const cookieHeader = `${OAUTH_STATE_COOKIE_NAME}=${state}`;
        expect(verifyOAuthState(state, cookieHeader, secret)).toBe(true);
        expect(verifyOAuthState(state, `${OAUTH_STATE_COOKIE_NAME}=other.state.val`, secret)).toBe(false);
        expect(verifyOAuthState(`${state.slice(0, -1)}x`, cookieHeader, secret)).toBe(false);
        expect(verifyOAuthState(state, cookieHeader, 'wrong-secret')).toBe(false);

        const futureNow = Date.now() + 15 * 60 * 1000;
        expect(verifyOAuthState(state, cookieHeader, secret, futureNow)).toBe(false);

        expect(buildClearOAuthStateCookieHeader(true)).toContain('Max-Age=0');
    });

    it('Unifies PlanGuard across payment/common and checks both REQUIRE_PLAN_KEY and legacy requiredPlan', async () => {
        expect(CommonPlanGuard).toBe(PlanGuard);
        expect(COMMON_REQUIRE_PLAN_KEY).toBe(REQUIRE_PLAN_KEY);

        const makeContext = (userId: string) =>
            ({
                getHandler: () => ({}),
                getClass: () => ({}),
                switchToHttp: () => ({ getRequest: () => ({ user: { id: userId } }) }),
            }) as unknown as ExecutionContext;

        const reflectorLegacy = {
            getAllAndOverride: jest
                .fn()
                .mockImplementation((key: string) =>
                    key === 'requiredPlan' ? PlanTier.PRO : undefined,
                ),
        } as unknown as Reflector;

        const planPermissionService = {
            checkPermission: jest
                .fn()
                .mockImplementation(async (uid: string) => uid === 'pro-user'),
        };

        const guard = new PlanGuard(reflectorLegacy, planPermissionService as any);
        await expect(guard.canActivate(makeContext('free-user'))).rejects.toThrow(
            ForbiddenException,
        );
        await expect(guard.canActivate(makeContext('pro-user'))).resolves.toBe(true);
    });

    it('JwtAuthGuard enforces 2FA verification whenever twoFactorEnabled=true (even for email 2FA)', async () => {
        const redisSecurity = {
            incrementWithWindow: jest.fn().mockResolvedValue({ count: 1 }),
        };
        const usersService = {
            getAuthGuardSnapshot: jest.fn().mockResolvedValue({
                id: 'user-2fa',
                isBlocked: false,
                twoFactorEnabled: true,
                isTwoFactorConfirmed: false,
            }),
        };

        const guard = new JwtAuthGuard(redisSecurity as any, usersService as any);
        const parentProto = Object.getPrototypeOf(JwtAuthGuard.prototype);
        const spy = jest.spyOn(parentProto, 'canActivate').mockResolvedValue(true);

        try {
            const unverifiedCtx = {
                switchToHttp: () => ({
                    getRequest: () => ({
                        ip: '127.0.0.1',
                        headers: {},
                        user: { id: 'user-2fa', isTwoFactorVerified: false },
                    }),
                }),
            } as unknown as ExecutionContext;

            await expect(guard.canActivate(unverifiedCtx)).rejects.toThrow(
                UnauthorizedException,
            );

            const verifiedCtx = {
                switchToHttp: () => ({
                    getRequest: () => ({
                        ip: '127.0.0.1',
                        headers: {},
                        user: { id: 'user-2fa', isTwoFactorVerified: true },
                    }),
                }),
            } as unknown as ExecutionContext;

            await expect(guard.canActivate(verifiedCtx)).resolves.toBe(true);
        } finally {
            spy.mockRestore();
        }
    });

    it('Mt5WorkerService enforces multi-tenant isolation for login mapping, credentials, and demo feeds', async () => {
        const accountRepo = {
            findOne: jest.fn().mockImplementation(async (opts: any) => {
                // Only non-DEMO customer account exists in repo; shared demo lookup must return null
                if (opts?.where?.type === AccountType.DEMO) return null;
                if (opts?.where?.userId === 'user-A') return null;
                return {
                    id: 'acc-victim',
                    userId: 'user-B',
                    mt5Id: '777777',
                    type: AccountType.CHALLENGE,
                };
            }),
            find: jest.fn().mockResolvedValue([]),
            save: jest.fn(),
            update: jest.fn(),
        };

        const svc = new Mt5WorkerService(
            accountRepo as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {
                emitToUser: jest.fn(),
                server: { to: jest.fn().mockReturnValue({ emit: jest.fn() }) },
            } as any,
            {} as any,
            {} as any,
            { get: jest.fn(), set: jest.fn() } as any,
            undefined,
            undefined,
            undefined,
            { get: jest.fn() } as any,
        );

        // 1. Existing loginToUserMap owner must NOT be overwritten by another userId task
        (svc as any).loginToUserMap.set('777777', 'user-A');
        const task = svc.createAccountTask(
            WorkerTaskType.START_ACCOUNT,
            '777777',
            'Exness-MT5Real',
            'TopSecret!123',
            101,
            { userId: 'user-B' },
        );
        expect((svc as any).loginToUserMap.get('777777')).toBe('user-A');

        // 2. Credential token is bound to taskId + accountId and single-use
        const credToken = task.credentialToken as string;
        expect(typeof credToken).toBe('string');

        expect(() => svc.exchangeCredential('wrong-task-id', 101, credToken)).toThrow(
            NotFoundException,
        );
        expect(() => svc.exchangeCredential(task.id, 999, credToken)).toThrow(
            NotFoundException,
        );

        const exchanged = svc.exchangeCredential(task.id, 101, credToken);
        expect(exchanged.password).toBe('TopSecret!123');
        expect(() => svc.exchangeCredential(task.id, 101, credToken)).toThrow(
            NotFoundException,
        );

        // 3. findAccountByLoginOrId must fail closed when mapped user-A has no matching account
        const resolvedAccount = await (svc as any).findAccountByLoginOrId('777777', 101);
        expect(resolvedAccount).toBeNull();

        // 4. getSharedDemoFeedAccount must never fall back to non-DEMO customer accounts
        const demoFeed = await svc.getSharedDemoFeedAccount();
        expect(demoFeed).toEqual(
            expect.objectContaining({
                configured: false,
                accountUuid: null,
                login: '',
            }),
        );
    });

    it('NetworkAcademyService.parseEmbedInput allows approved HTTPS embeds and blocks arbitrary origins', () => {
        const svc = Object.create(NetworkAcademyService.prototype) as NetworkAcademyService;

        const yt = svc.parseEmbedInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        expect(yt.embedType).toBe('iframe');
        expect(yt.embedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1');

        const panda = svc.parseEmbedInput('https://player-vz-123.tv.pandavideo.com.br/embed/?v=abc');
        expect(panda.embedType).toBe('iframe');

        expect(() => svc.parseEmbedInput('https://evil.example/embed/phishing')).toThrow(
            BadRequestException,
        );
        expect(() => svc.parseEmbedInput('http://pandavideo.com.br/embed/?v=abc')).toThrow(
            BadRequestException,
        );
    });
});
