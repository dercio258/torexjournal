import { createECDH, randomBytes } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
    getAdminJwtSecret,
    getAnalyticsHmacSecret,
    getJwtSecret,
    getOAuthStateSecret,
    getPasswordResetSecret,
    getTwoFactorJwtSecret,
} from './common/security/security.config';
import { AdminAuthGuard } from './admin/admin-auth.guard';
import {
    resolveCountryFromHeadersOrTimezone,
    validateAndNormalizeContact,
} from './auth/phone-prefix.util';
import { UsersService } from './users/users.service';
import { NetworkService } from './network/network.service';
import {
    buildVapidAuthorizationHeader,
    decryptWebPushAes128Gcm,
    encryptWebPushAes128Gcm,
    generateVapidKeyPair,
    verifyVapidJwtForTest,
} from './notifications/push/web-push-crypto.util';
import { PushCopyAiService } from './notifications/push/push-copy-ai.service';
import {
    PushProducerService,
    sanitizeSafePushPayload,
} from './notifications/push/push-producer.service';
import { AnalyticsService } from './analytics/analytics.service';
import { ReferralService } from './users/referral.service';

describe('Phase 3: Segregated Secrets, @username Privacy, 2-Step Register & Smart Web Push', () => {
    const prevEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...prevEnv };
    });

    it('strictly isolates Admin JWT secrets from User JWT secrets in production', async () => {
        process.env.NODE_ENV = 'production';
        process.env.JWT_SECRET = 'user_super_strong_production_secret_32b_alpha';
        delete process.env.ADMIN_JWT_SECRET;

        expect(() => getAdminJwtSecret()).toThrow(/ADMIN_JWT_SECRET/i);

        process.env.ADMIN_JWT_SECRET = process.env.JWT_SECRET;
        expect(() => getAdminJwtSecret()).toThrow(/diferente/i);

        process.env.ADMIN_JWT_SECRET = 'admin_super_strong_production_secret_32b_omega';
        process.env.ADMIN_EMAIL = 'admin@torex.app';

        const config = {
            get: (k: string) => process.env[k],
        } as unknown as ConfigService;

        const jwt = new JwtService();
        const userSecret = getJwtSecret(config);
        const adminSecret = getAdminJwtSecret(config);
        expect(userSecret).not.toEqual(adminSecret);

        // Domain secrets are distinct from one another
        expect(new Set([
            userSecret,
            adminSecret,
            getTwoFactorJwtSecret(config),
            getPasswordResetSecret(config),
            getOAuthStateSecret(config),
            getAnalyticsHmacSecret(config),
        ]).size).toBe(6);

        const guard = new AdminAuthGuard(jwt, config);
        const forgedUserToken = jwt.sign(
            { email: 'admin@torex.app', role: 'admin', isAdmin: true },
            { secret: userSecret },
        );
        const validAdminToken = jwt.sign(
            { email: 'admin@torex.app', role: 'admin', isAdmin: true },
            { secret: adminSecret },
        );

        const makeCtx = (token: string): any => ({
            switchToHttp: () => ({
                getRequest: () => ({
                    headers: { authorization: `Bearer ${token}` },
                }),
            }),
        });

        await expect(guard.canActivate(makeCtx(forgedUserToken))).rejects.toThrow();
        await expect(guard.canActivate(makeCtx(validAdminToken))).resolves.toBe(true);
    });

    it('generates clean first-name @username and appends random digits on collision', async () => {
        const taken = new Set<string>();
        const usersRepoMock: any = {
            createQueryBuilder: () => {
                let candidate = '';
                const qb: any = {
                    select: () => qb,
                    where: (_sql: string, params: { candidate: string }) => {
                        candidate = params.candidate;
                        return qb;
                    },
                    andWhere: () => qb,
                    getOne: async () => (taken.has(candidate.toLowerCase()) ? { id: 'existing' } : null),
                };
                return qb;
            },
            create: (data: any) => data,
            save: async (u: any) => {
                taken.add(u.username.toLowerCase());
                return { id: `user-${taken.size}`, ...u };
            },
        };
        const cacheMock: any = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
        const usersService = new UsersService(usersRepoMock, cacheMock);

        const u1 = await usersService.create({ name: 'João Silva', email: 'joao1@example.com' });
        const u2 = await usersService.create({ name: 'João Costa', email: 'joao2@example.com' });

        expect(u1.username).toBe('joao');
        expect(u2.username).toMatch(/^joao\d{4,6}$/);
        expect(u2.username).not.toContain('@');
        expect(u2.username).not.toContain(' ');
    });

    it('never exposes name or email in /network feed, search, or suggestions', async () => {
        const whereCalls: string[] = [];
        const qbMock: any = {
            where: () => qbMock,
            select: () => qbMock,
            andWhere: (sql: string) => {
                whereCalls.push(sql);
                return qbMock;
            },
            orderBy: () => qbMock,
            take: () => qbMock,
            getMany: async () => [
                {
                    id: 'u-1',
                    username: 'ana4812',
                    name: 'Ana Carolina Privada',
                    email: 'ana@private.com',
                    avatarUrl: null,
                },
            ],
        };
        const networkService = new NetworkService(
            {
                findAndCount: async () => [
                    [
                        {
                            id: 10,
                            content: 'Setup XAUUSD',
                            likesCount: 2,
                            commentsCount: 0,
                            createdAt: new Date(),
                            userId: 'u-1',
                            user: {
                                id: 'u-1',
                                username: 'ana4812',
                                name: 'Ana Carolina Privada',
                                email: 'ana@private.com',
                                avatarUrl: null,
                            },
                            comments: [],
                        },
                    ],
                    1,
                ],
            } as any,
            {} as any,
            { find: async () => [] } as any,
            {} as any,
            {} as any,
            { find: async () => [] } as any,
            { createQueryBuilder: () => qbMock } as any,
            { getOnlineUserIds: () => [] } as any,
        );

        const feed = await networkService.getFeed('viewer-1', 1);
        expect(feed.data[0].user).toEqual({
            id: 'u-1',
            username: 'ana4812',
            avatarUrl: null,
        });
        expect((feed.data[0].user as any).name).toBeUndefined();
        expect((feed.data[0].user as any).email).toBeUndefined();

        const users = await networkService.getUsers('viewer-1', 'ana');
        expect(users[0]).toEqual({
            id: 'u-1',
            username: 'ana4812',
            avatarUrl: null,
            isFollowing: false,
        });
        expect((users[0] as any).name).toBeUndefined();
        expect((users[0] as any).email).toBeUndefined();
        expect(whereCalls.some((w) => w.includes('user.name'))).toBe(false);
    });

    it('resolves cookie-consented geo prefix and validates E.164 phone strictly', () => {
        const tzHint = resolveCountryFromHeadersOrTimezone({}, 'Africa/Maputo');
        expect(tzHint).toEqual({ countryIso2: 'MZ', dialCode: '+258', source: 'timezone' });

        const cfHint = resolveCountryFromHeadersOrTimezone({ 'cf-ipcountry': 'PT' }, 'UTC');
        expect(cfHint).toEqual({ countryIso2: 'PT', dialCode: '+351', source: 'geo-header' });

        const okMz = validateAndNormalizeContact('841234567', 'MZ');
        expect(okMz).toMatchObject({ valid: true, normalized: '+258841234567', countryIso2: 'MZ' });

        const missingPrefix = validateAndNormalizeContact('841234567', undefined);
        expect(missingPrefix.valid).toBe(false);

        const wrongLength = validateAndNormalizeContact('8412', 'MZ');
        expect(wrongLength.valid).toBe(false);
    });

    it('encrypts Web Push RFC 8291 (aes128gcm) + signs RFC 8292 VAPID JWT cleanly', () => {
        const uaEcdh = createECDH('prime256v1');
        uaEcdh.generateKeys();
        const authSecret = randomBytes(16);

        const payload = {
            title: 'Foram adicionadas 3 operações em XAUUSD',
            body: 'Diga como se sentiu — preencha o diário em 2 min.',
            url: '/journal?from=push_import',
        };

        const { body } = encryptWebPushAes128Gcm({
            payload: JSON.stringify(payload),
            p256dh: uaEcdh.getPublicKey().toString('base64url'),
            auth: authSecret.toString('base64url'),
        });

        const decrypted = decryptWebPushAes128Gcm({
            body,
            uaPrivateKey: uaEcdh.getPrivateKey(),
            uaPublicKey: uaEcdh.getPublicKey(),
            authSecret,
        });
        expect(JSON.parse(decrypted.toString('utf8'))).toEqual(payload);

        const vapid = generateVapidKeyPair('mailto:ops@torex.app');
        const authHeader = buildVapidAuthorizationHeader({
            audienceOrigin: 'https://fcm.googleapis.com',
            vapidPublicKey: vapid.publicKey,
            vapidPrivateKey: vapid.privateKey,
            subject: vapid.subject,
        });
        expect(authHeader.startsWith('vapid t=')).toBe(true);
        const tokenPart = authHeader.split(',')[0].replace('vapid t=', '').trim();
        const verifiedClaims = verifyVapidJwtForTest(tokenPart, vapid.publicKey);
        expect(verifiedClaims?.aud).toBe('https://fcm.googleapis.com');
        expect(verifiedClaims?.sub).toBe('mailto:ops@torex.app');
    });

    it('enforces push anti-spam caps, generates 2-min journal copy, and notifies sampled online community traders', async () => {
        const kv = new Map<string, string>();
        const redisMock: any = {
            getValue: jest.fn(async (k: string) => kv.get(k) ?? null),
            setValue: jest.fn(async (k: string, v: string) => {
                kv.set(k, v);
            }),
            setIfAbsent: jest.fn(async (k: string, v: string) => {
                if (kv.has(k)) return false;
                kv.set(k, v);
                return true;
            }),
            incrementWithWindow: jest.fn(async (k: string) => {
                const next = Number(kv.get(k) || '0') + 1;
                kv.set(k, String(next));
                return { count: next, resetAt: Date.now() + 60_000 };
            }),
            consumeOnce: jest.fn(async (k: string) => {
                const val = kv.get(k) ?? null;
                kv.delete(k);
                return val;
            }),
        };

        const enqueuedJobs: any[] = [];
        const pushQueueMock: any = {
            add: jest.fn(async (name: string, data: any) => {
                enqueuedJobs.push({ name, data });
            }),
        };

        const subRepoMock: any = {
            count: jest.fn(async () => 1),
            find: jest.fn(async () => [{ userId: 'u-online-1' }, { userId: 'u-online-2' }]),
        };
        const userRepoMock: any = {
            find: jest.fn(async () => [
                { id: 'u-online-1', username: 'carlos21', preferredLocale: 'pt' },
                { id: 'u-online-2', username: 'maria99', preferredLocale: 'pt' },
            ]),
            findOne: jest.fn(async () => ({ id: 'u-1', username: 'joao', preferredLocale: 'pt' })),
        };
        const journalRepoMock: any = {
            count: jest.fn(async () => 0),
        };

        const copyAi = new PushCopyAiService({ get: () => '' } as unknown as ConfigService);
        const producer = new PushProducerService(
            pushQueueMock,
            subRepoMock,
            userRepoMock,
            journalRepoMock,
            redisMock,
            copyAi,
        );

        await producer.handleNetworkRoomMessage({
            authorId: 'u-author',
            authorUsername: 'marcos',
            room: 'forex-gold',
            onlineUserIds: ['u-online-1', 'u-online-2', 'u-author'],
        });

        expect(enqueuedJobs.length).toBe(2);
        expect(enqueuedJobs[0].data.body).toMatch(/^Olá @(carlos21|maria99), uma nova conversa/);
        expect(enqueuedJobs[0].data.url).toBe('/network?tab=chat&room=forex-gold');

        // Global cooldown prevents back-to-back spam push to u-online-1
        const allowedSecond = await producer.reservePushQuota('u-online-1', 'curiosity-insight');
        expect(allowedSecond).toBe(false);

        const aiFallback = await copyAi.generatePostImportJournalCopy({
            locale: 'pt',
            tradesCount: 4,
            topSymbol: 'XAUUSD',
            netPnl: 120,
        });
        expect(aiFallback.title).toContain('4 operações');
        expect(aiFallback.body).toContain('2 min');
    });

    it('redacts sensitive query parameters in persisted email click analytics while keeping valid redirect URL', async () => {
        let savedLastUrl = '';
        let savedTargetUrl = '';
        const qbUpdateMock: any = {
            update: () => qbUpdateMock,
            set: (fields: any) => {
                savedLastUrl = fields.lastClickedUrl;
                return qbUpdateMock;
            },
            where: () => qbUpdateMock,
            execute: async () => ({}),
        };

        const analytics = new AnalyticsService(
            { create: (x: any) => x, save: jest.fn() } as any,
            {
                findOne: async () => ({ token: 'tok-1', userId: 'u-1', template: 'RESET' }),
                createQueryBuilder: () => qbUpdateMock,
            } as any,
            { findOne: async () => null, create: jest.fn(), save: jest.fn() } as any,
            { find: async () => [] } as any,
            { get: (k: string) => (k === 'ANALYTICS_HMAC_SECRET' ? 'secret-analytics-key-32-chars-ok' : '') } as any,
        );

        jest.spyOn(analytics, 'recordEvent').mockImplementation(async (dto: any) => {
            savedTargetUrl = dto.targetUrl || '';
        });

        const dest = 'https://torexjournal.com/reset-password?email=u@x.com&token=SECRET123&sig=HMAC999&otp=445566';
        const sig = (analytics as any).signEmailRedirect('tok-1', dest);
        const returned = await analytics.trackEmailClick('tok-1', dest, sig, 'cta_reset');

        expect(returned).toBe(dest);
        expect(savedLastUrl).toContain('token=%5BREDACTED%5D');
        expect(savedLastUrl).toContain('sig=%5BREDACTED%5D');
        expect(savedLastUrl).toContain('otp=%5BREDACTED%5D');
        expect(savedLastUrl).not.toContain('SECRET123');
        expect(savedLastUrl).not.toContain('HMAC999');
        expect(savedLastUrl).not.toContain('445566');
        expect(savedTargetUrl).toBe(savedLastUrl);
    });

    it('blocks security/OTP pushes and redacts financial balances, emails, phones, and account/ticket IDs', () => {
        const otpBlocked = sanitizeSafePushPayload(
            'Seu código OTP 2FA',
            'Use o código 482910 para validar seu login agora.',
            'security-otp',
        );
        expect(otpBlocked.allowed).toBe(false);

        const pwdBlocked = sanitizeSafePushPayload(
            'Redefinição de senha solicitada',
            'Clique para continuar.',
            'security',
        );
        expect(pwdBlocked.allowed).toBe(false);

        const redacted = sanitizeSafePushPayload(
            'Conta #99887766 atualizada · trader@torex.com',
            'Saldo $1,450.25 com lucro 250 MZN · contacto +258 84 123 4567 no ticket 1234567',
            'journal-reminder',
        );
        expect(redacted.allowed).toBe(true);
        expect(redacted.title).not.toContain('99887766');
        expect(redacted.title).not.toContain('trader@torex.com');
        expect(redacted.body).not.toContain('1,450.25');
        expect(redacted.body).not.toContain('250 MZN');
        expect(redacted.body).not.toContain('+258 84 123 4567');
        expect(redacted.body).not.toContain('1234567');

        const safeJournal = sanitizeSafePushPayload(
            'Foram adicionadas 5 operações em XAUUSD',
            'Preencha o diário — leva apenas 2 min.',
            'journal-reminder',
        );
        expect(safeJournal.allowed).toBe(true);
        expect(safeJournal.title).toContain('5 operações');
        expect(safeJournal.body).toContain('2 min');
    });

    it('moderates push frequency (ENGAGED -> MODERATED -> FATIGUE_PAUSED) and resets on click', async () => {
        const kv = new Map<string, string>();
        let logs: any[] = [];
        const redisMock: any = {
            getValue: jest.fn(async (k: string) => kv.get(k) ?? null),
            setValue: jest.fn(async (k: string, v: string) => {
                kv.set(k, v);
            }),
            incrementWithWindow: jest.fn(async (k: string) => {
                const next = Number(kv.get(k) || '0') + 1;
                kv.set(k, String(next));
                return { count: next, resetAt: Date.now() + 60_000 };
            }),
        };

        const producer = new PushProducerService(
            { add: jest.fn() } as any,
            { count: async () => 1 } as any,
            {} as any,
            {} as any,
            redisMock,
            new PushCopyAiService({ get: () => '' } as unknown as ConfigService),
            undefined,
            { find: async () => logs } as any,
        );

        const recentSent = new Date(Date.now() - 2 * 3600_000);
        logs = [
            { status: 'SENT', category: 'journal-reminder', sentAt: recentSent },
            { status: 'DISMISSED', category: 'curiosity-insight', sentAt: recentSent },
            { status: 'SENT', category: 'community-room', sentAt: recentSent },
        ];
        const moderated = await producer.evaluateUserPushModeration('u-mod');
        expect(moderated.mode).toBe('MODERATED');
        expect(moderated.dailyCap).toBe(1);
        expect(moderated.cooldownMs).toBe(24 * 3600_000);
        // Within 24h window -> quota blocked even without Redis cooldown key
        expect(await producer.reservePushQuota('u-mod', 'community-post')).toBe(false);

        logs = Array.from({ length: 6 }, () => ({
            status: 'DISMISSED',
            category: 'community-post',
            sentAt: new Date(Date.now() - 48 * 3600_000),
        }));
        const fatigued = await producer.evaluateUserPushModeration('u-mod');
        expect(fatigued.mode).toBe('FATIGUE_PAUSED');
        expect(fatigued.cooldownMs).toBe(72 * 3600_000);
        // 48h ago < 72h -> blocked
        expect(await producer.reservePushQuota('u-mod', 'curiosity-insight')).toBe(false);

        logs = [{ status: 'CLICKED', category: 'curiosity-insight', sentAt: recentSent }, ...logs];
        const reEngaged = await producer.evaluateUserPushModeration('u-mod');
        expect(reEngaged.mode).toBe('ENGAGED');
        expect(reEngaged.dailyCap).toBe(4);
    });

    it('attributes referrals idempotently, awards credits, blocks self-referral, and unlocks tier boost', async () => {
        const users = new Map<string, any>([
            [
                'u-ref',
                {
                    id: 'u-ref',
                    username: 'ambassador',
                    name: 'Ambassador Trader',
                    email: 'amb@torex.com',
                    referralCode: 'AMB1234',
                    referralCreditsUsd: 0,
                    referralTierBoost: false,
                },
            ],
            [
                'u-f1',
                {
                    id: 'u-f1',
                    username: 'friend1',
                    name: 'Friend 1',
                    email: 'f1@torex.com',
                    referredByUserId: null,
                },
            ],
            [
                'u-f2',
                {
                    id: 'u-f2',
                    username: 'friend2',
                    name: 'Friend 2',
                    email: 'f2@torex.com',
                    referredByUserId: null,
                },
            ],
        ]);
        const referrals: any[] = [];

        const userRepoMock: any = {
            findOne: jest.fn(async ({ where }: any) => {
                if (where?.id) return users.get(where.id) || null;
                if (where?.referralCode) {
                    return Array.from(users.values()).find((u) => u.referralCode === where.referralCode) || null;
                }
                return null;
            }),
            update: jest.fn(async ({ id }: any, patch: any) => {
                const existing = users.get(id);
                if (existing) users.set(id, { ...existing, ...patch });
            }),
        };

        const referralRepoMock: any = {
            findOne: jest.fn(async ({ where }: any) => {
                if (where?.referredUserId) {
                    return referrals.find((r) => r.referredUserId === where.referredUserId) || null;
                }
                return null;
            }),
            count: jest.fn(async ({ where }: any) =>
                referrals.filter((r) => {
                    if (where?.referrerUserId && r.referrerUserId !== where.referrerUserId) return false;
                    if (typeof where?.status === 'string') return r.status === where.status;
                    if (where?.status?.value) return where.status.value.includes(r.status);
                    return true;
                }).length,
            ),
            create: (obj: any) => ({ id: `ref-${referrals.length + 1}`, createdAt: new Date(), ...obj }),
            save: jest.fn(async (obj: any) => {
                const idx = referrals.findIndex((r) => r.referredUserId === obj.referredUserId);
                if (idx >= 0) referrals[idx] = obj;
                else referrals.push(obj);
                return obj;
            }),
        };

        const referralService = new ReferralService(
            referralRepoMock,
            userRepoMock,
            {
                get: (k: string) =>
                    k === 'REFERRAL_VERIFY_CREDIT_USD' ? '2' : k === 'REFERRAL_PAID_CREDIT_USD' ? '8' : undefined,
            } as any,
        );

        // Self-referral must fail safely
        const selfRes = await referralService.processVerifiedSignup('u-ref', 'AMB1234');
        expect(selfRes.attributed).toBe(false);

        // Verified signup 1 (+$2) & idempotent retry
        const firstSignup = await referralService.processVerifiedSignup('u-f1', 'amb1234');
        expect(firstSignup).toEqual({ attributed: true, creditedUsd: 2, tierBoostUnlocked: false });
        const duplicateSignup = await referralService.processVerifiedSignup('u-f1', 'AMB1234');
        expect(duplicateSignup.attributed).toBe(false);
        expect(users.get('u-ref').referralCreditsUsd).toBe(2);

        // Verified signup 2 (+$2 -> $4 total)
        await referralService.processVerifiedSignup('u-f2', 'AMB1234');
        expect(users.get('u-ref').referralCreditsUsd).toBe(4);

        // Paid conversion 1 (+$8 -> $12 total) & paid conversion 2 (+$8 -> $20 + unlocks tier boost!)
        const paid1 = await referralService.processPaidConversion('u-f1');
        expect(paid1).toEqual({ awarded: true, creditedUsd: 8, tierBoostUnlocked: false });
        expect(await referralService.processPaidConversion('u-f1')).toEqual({
            awarded: false,
            creditedUsd: 0,
            tierBoostUnlocked: false,
        });

        const paid2 = await referralService.processPaidConversion('u-f2');
        expect(paid2).toEqual({ awarded: true, creditedUsd: 8, tierBoostUnlocked: true });
        expect(users.get('u-ref').referralCreditsUsd).toBe(20);
        expect(users.get('u-ref').referralTierBoost).toBe(true);
    });
});
