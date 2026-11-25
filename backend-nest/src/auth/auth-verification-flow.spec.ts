import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

jest.mock('otplib', () => ({
    generateSecret: jest.fn(() => 'JBSWY3DPEHPK3PXP'),
    generateURI: jest.fn(() => 'otpauth://totp/Torex:test@example.com?secret=JBSWY3DPEHPK3PXP'),
    verifySync: jest.fn(() => ({ valid: true })),
}));

import { AuthService } from './auth.service';
import { RedisSecurityService } from '../common/security/redis-security.service';
import { hashPasswordSecure } from '../common/security/password-hash.util';
import { validateAndNormalizeContact } from './phone-prefix.util';

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
    const map: Record<string, string> = {
        NODE_ENV: 'test',
        JWT_SECRET: 'unit-test-user-jwt-secret-key-32-chars-min',
        TWO_FACTOR_JWT_SECRET: 'unit-test-2fa-jwt-secret-key-32-chars-min',
        PASSWORD_RESET_SECRET: 'unit-test-reset-secret-key-32-chars-min',
        SKIP_EMAIL_DNS_CHECK: 'true',
        ...overrides,
    };
    return {
        get: (key: string, def?: any) => (key in map ? map[key] : def),
    } as unknown as ConfigService;
}

function makeHarness(options: { enqueueResult?: boolean; fallbackSendResult?: boolean } = {}) {
    const usersById = new Map<string, any>();
    const usersByEmail = new Map<string, any>();
    const accountsByUserId = new Map<string, any>();
    const sentEmails: Array<{ to: string; template: string; data: any }> = [];
    const fallbackEmails: Array<{ to: string; template: string; data: any }> = [];
    const auditEvents: Array<{ userId: string | null | undefined; action: string }> = [];
    let userSeq = 0;

    const usersService: any = {
        findOneByEmail: jest.fn(async (email: string) => usersByEmail.get(email.trim().toLowerCase()) || undefined),
        findOneById: jest.fn(async (id: string) => usersById.get(id) || undefined),
        create: jest.fn(async (data: any) => {
            userSeq += 1;
            const user = {
                id: `00000000-0000-4000-8000-00000000000${userSeq}`,
                isBlocked: false,
                twoFactorEnabled: false,
                isTwoFactorConfirmed: false,
                onboardingCompleted: false,
                ...data,
            };
            usersById.set(user.id, user);
            usersByEmail.set(user.email.toLowerCase(), user);
            return user;
        }),
        update: jest.fn(async (user: any) => {
            usersById.set(user.id, user);
            if (user.email) usersByEmail.set(user.email.toLowerCase(), user);
            return user;
        }),
        updateRefreshToken: jest.fn(async (userId: string, rt: string | null) => {
            const u = usersById.get(userId);
            if (u) u.refreshToken = rt;
        }),
        recordUserActivity: jest.fn(async () => undefined),
        invalidateAuthGuardCache: jest.fn(async () => undefined),
    };

    const accountRepository: any = {
        findOne: jest.fn(async ({ where }: any) => accountsByUserId.get(where?.userId) || null),
        create: jest.fn((data: any) => data),
        save: jest.fn(async (acc: any) => {
            const saved = { id: `acc-${acc.userId}`, ...acc };
            accountsByUserId.set(acc.userId, saved);
            return saved;
        }),
    };

    const sessionRepository: any = {
        save: jest.fn(async (s: any) => s),
        find: jest.fn(async () => []),
        update: jest.fn(async () => undefined),
    };

    const emailProducer: any = {
        enqueue: jest.fn(async (to: string, template: string, data: any) => {
            if (options.enqueueResult === false) return false;
            sentEmails.push({ to, template, data });
            return true;
        }),
    };

    const emailService: any = {
        sendTemplatedEmail: jest.fn(async (to: string, template: string, data: any) => {
            if (options.fallbackSendResult === false) return false;
            fallbackEmails.push({ to, template, data });
            return true;
        }),
    };

    const cacheStore = new Map<string, any>();
    const cacheManager: any = {
        get: jest.fn(async (k: string) => cacheStore.get(k) ?? null),
        set: jest.fn(async (k: string, v: any) => {
            cacheStore.set(k, v);
        }),
        del: jest.fn(async (k: string) => {
            cacheStore.delete(k);
        }),
    };

    const planPermissionService: any = {
        getUserPlan: jest.fn(async () => 'FREE'),
    };

    const notificationsService: any = {};

    const auditLogService: any = {
        log: jest.fn(async (userId: string | null | undefined, action: string) => {
            auditEvents.push({ userId, action });
            return null;
        }),
    };

    const configService = makeConfig();
    const jwtService = new JwtService({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '24h' },
    });
    const redisSecurity = new RedisSecurityService(configService);
    const analyticsService: any = {
        identifyVisitor: jest.fn(async () => undefined),
        recordAuthOrBillingConversion: jest.fn(async () => undefined),
    };
    const referralService: any = {
        processVerifiedSignup: jest.fn(async () => ({ attributed: false })),
        ensureReferralCode: jest.fn(async () => 'TRX123'),
    };

    const authService = new AuthService(
        usersService,
        jwtService,
        accountRepository,
        sessionRepository,
        emailProducer,
        cacheManager,
        planPermissionService,
        notificationsService,
        auditLogService,
        configService,
        redisSecurity,
        analyticsService,
        referralService,
        undefined,
        emailService,
    );

    return {
        authService,
        usersService,
        usersByEmail,
        usersById,
        sentEmails,
        fallbackEmails,
        auditEvents,
        redisSecurity,
        emailProducer,
        emailService,
    };
}

describe('Auth registration, email verification & first-login redirect flow', () => {
    beforeAll(() => {
        process.env.SKIP_EMAIL_DNS_CHECK = 'true';
    });

    it('persists unverified account on initiateRegistration, allows re-registration while unverified, and blocks verified duplicates', async () => {
        const h = makeHarness();

        const init1 = await h.authService.initiateRegistration({
            name: 'João Silva',
            email: 'joao.trader@gmail.com',
            password: 'Vortex#94Km!',
            contact: '+258841234567',
            countryIso2: 'MZ',
            preferredLocale: 'pt',
        });

        expect(init1.success).toBe(true);
        expect(init1.verificationToken).toBeTruthy();
        expect(init1.codeSent).toBe(true);
        expect(h.sentEmails).toHaveLength(1);
        expect(h.sentEmails[0].template).toBe('OTP_CODE');

        const created = h.usersByEmail.get('joao.trader@gmail.com');
        expect(created).toBeDefined();
        expect(created.emailVerifiedAt).toBeNull();

        // Re-initiating while unverified within cooldown reuses active verification session instead of throwing Conflict/429
        const init2 = await h.authService.initiateRegistration({
            name: 'João Silva Updated',
            email: 'joao.trader@gmail.com',
            password: 'Vortex#94Km!',
            contact: '+258841234568',
            countryIso2: 'MZ',
            preferredLocale: 'pt',
        });

        expect(init2.success).toBe(true);
        expect(init2.verificationToken).toBeTruthy();
        expect(init2.codeSent).toBe(false);
        expect(created.name).toBe('João Silva Updated');
        expect(created.whatsapp).toBe('+258841234568');

        // Verify OTP completes registration and issues JWT
        const otp = h.sentEmails[0].data.otp;
        const verified = await h.authService.verifyRegistration(init2.verificationToken, otp);
        expect(verified.success).toBe(true);
        expect((verified as any).token).toBeTruthy();
        expect(created.emailVerifiedAt).toBeInstanceOf(Date);

        // Re-submitting verifyRegistration after already verified returns alreadyVerified cleanly without error
        const dupVerify: any = await h.authService.verifyRegistration(init2.verificationToken, otp);
        expect(dupVerify.success).toBe(true);
        expect(dupVerify.alreadyVerified).toBe(true);

        // Now that the account is verified, duplicate registration MUST throw ConflictException
        await expect(
            h.authService.initiateRegistration({
                name: 'João Silva',
                email: 'joao.trader@gmail.com',
                password: 'Vortex#94Km!',
                contact: '+258841234567',
                countryIso2: 'MZ',
                preferredLocale: 'pt',
            }),
        ).rejects.toThrow(ConflictException);
    });

    it('redirects unverified user to verification page on first login instead of issuing JWT or failing', async () => {
        const h = makeHarness();

        await h.authService.initiateRegistration({
            name: 'Maria Trader',
            email: 'maria.fx@gmail.com',
            password: 'Norte@48Cais#',
            contact: '+351912345678',
            countryIso2: 'PT',
            preferredLocale: 'pt',
        });

        // Wrong password still rejects with UnauthorizedException
        await expect(
            h.authService.authenticateAndLogin('maria.fx@gmail.com', 'WrongPass!99'),
        ).rejects.toThrow(UnauthorizedException);

        // First login with valid credentials while unverified returns requiresEmailVerification + verificationToken
        const loginRes: any = await h.authService.authenticateAndLogin(
            'maria.fx@gmail.com',
            'Norte@48Cais#',
        );
        expect(loginRes.success).toBe(true);
        expect(loginRes.requiresEmailVerification).toBe(true);
        expect(loginRes.verificationToken).toBeTruthy();
        expect(loginRes.token).toBeUndefined();

        // Completing verification with OTP issues full session token
        const otp = h.sentEmails[h.sentEmails.length - 1].data.otp;
        const verified: any = await h.authService.verifyRegistration(loginRes.verificationToken, otp);
        expect(verified.success).toBe(true);
        expect(verified.token).toBeTruthy();

        // Subsequent login succeeds directly without email verification prompt
        const loginAfter: any = await h.authService.authenticateAndLogin(
            'maria.fx@gmail.com',
            'Norte@48Cais#',
        );
        expect(loginAfter.success).toBe(true);
        expect(loginAfter.requiresEmailVerification).toBeUndefined();
        expect(loginAfter.token).toBeTruthy();
    });

    it('supports resending OTP even after the 15-min OTP TTL expires without forcing re-registration', async () => {
        const h = makeHarness();

        const init = await h.authService.initiateRegistration({
            name: 'Carlos Mendes',
            email: 'carlos.m@gmail.com',
            password: 'Kestrel!82Zp',
            contact: '+5511999998888',
            countryIso2: 'BR',
            preferredLocale: 'pt',
        });
        const user = h.usersByEmail.get('carlos.m@gmail.com');

        // Simulate OTP and cooldown expiration after 15+ minutes
        await h.redisSecurity.deleteKey(`acct_verify:${user.id}`);
        await h.redisSecurity.deleteKey(`email_verify_cooldown:${user.id}`);

        // Entering an old code fails gracefully instructing user to resend
        await expect(
            h.authService.verifyRegistration(init.verificationToken, '123456'),
        ).rejects.toThrow(BadRequestException);

        // Resend works seamlessly using the 24h verificationToken
        const resendRes = await h.authService.resendRegistrationOtp(init.verificationToken);
        expect(resendRes.success).toBe(true);
        expect(h.sentEmails).toHaveLength(2);

        const freshOtp = h.sentEmails[1].data.otp;
        const verified: any = await h.authService.verifyRegistration(
            resendRes.verificationToken || init.verificationToken,
            freshOtp,
        );
        expect(verified.token).toBeTruthy();
    });

    it('falls back to direct EmailService when Bull queue enqueue returns false and still verifies cleanly', async () => {
        const h = makeHarness({ enqueueResult: false, fallbackSendResult: true });

        const init = await h.authService.initiateRegistration({
            name: 'Ana Costa',
            email: 'ana.costa@gmail.com',
            password: 'Quasar#71Lp',
            contact: '+258821234567',
            countryIso2: 'MZ',
            preferredLocale: 'pt',
        });

        expect(init.codeSent).toBe(true);
        expect(h.fallbackEmails).toHaveLength(1);
        expect(h.fallbackEmails[0].template).toBe('OTP_CODE');

        const verified: any = await h.authService.verifyRegistration(
            init.verificationToken,
            h.fallbackEmails[0].data.otp,
        );
        expect(verified.token).toBeTruthy();
    });

    it('marks unverified email as verified upon successful password reset via email code', async () => {
        const h = makeHarness();

        const user = await h.usersService.create({
            name: 'Legacy Unverified',
            email: 'legacy.unverified@gmail.com',
            passwordHash: await hashPasswordSecure('OldStrong#91Kp'),
            emailVerifiedAt: null,
        });

        await h.authService.forgotPassword('legacy.unverified@gmail.com');
        const recoveryEmail = h.sentEmails.find((e) => e.template === 'PASSWORD_RECOVERY');
        expect(recoveryEmail).toBeDefined();

        await h.authService.resetPassword({
            email: 'legacy.unverified@gmail.com',
            code: recoveryEmail!.data.code,
            newPassword: 'NewStrong#94Km!',
        });

        expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('does not misapply US +1 length validation to other +1xxx countries outside catalog', () => {
        const res = validateAndNormalizeContact('+18095551234', 'DO');
        expect(res.valid).toBe(true);
        expect(res.normalized).toBe('+18095551234');
    });
});
