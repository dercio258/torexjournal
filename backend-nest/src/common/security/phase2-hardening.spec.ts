import { createCipheriv, createECDH, hkdfSync, randomBytes } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import {
    extractAdminToken,
    extractSocketTokenFromHandshake,
    extractUserAccessToken,
    isCookieAuthenticatedMutation,
    parseCookies,
    setUserSessionCookies,
} from './cookie-security.util';
import {
    decryptRequestEnvelopeFromClient,
    getServerKemPublicBundle,
    isEncryptedRequestEnvelope,
} from './payload-envelope.util';
import { AdminAuditService } from '../../admin/admin-audit.service';
import {
    WorkerAuthGuard,
    computeWorkerRequestHmac,
} from '../../mt5/worker/worker-auth.guard';

describe('Phase P2 Security Hardening', () => {
    describe('HttpOnly Cookie Security & CSRF Origin Helpers', () => {
        it('parses cookies safely without prototype pollution and extracts user/admin/socket tokens', () => {
            const parsed = parseCookies('__proto__=evil; __Host-torex_at=jwt_abc; __Host-torex_admin=adm_xyz');
            expect(parsed['__Host-torex_at']).toBe('jwt_abc');
            expect(parsed['__Host-torex_admin']).toBe('adm_xyz');
            expect(({} as any).evil).toBeUndefined();

            expect(
                extractUserAccessToken({ headers: { cookie: '__Host-torex_at=cookie_jwt' } }),
            ).toBe('cookie_jwt');
            expect(
                extractAdminToken({ headers: { cookie: '__Host-torex_admin=admin_cookie_jwt' } }),
            ).toBe('admin_cookie_jwt');
            expect(
                extractSocketTokenFromHandshake({
                    headers: { cookie: '__Host-torex_at=ws_cookie_jwt' },
                }),
            ).toBe('ws_cookie_jwt');
        });

        it('detects cookie-authenticated mutations for CSRF origin enforcement', () => {
            expect(
                isCookieAuthenticatedMutation({
                    method: 'POST',
                    headers: { cookie: '__Host-torex_at=abc' },
                }),
            ).toBe(true);
            expect(
                isCookieAuthenticatedMutation({
                    method: 'POST',
                    headers: {
                        cookie: '__Host-torex_at=abc',
                        authorization: 'Bearer abc',
                    },
                }),
            ).toBe(false);
            expect(
                isCookieAuthenticatedMutation({
                    method: 'GET',
                    headers: { cookie: '__Host-torex_at=abc' },
                }),
            ).toBe(false);
        });

        it('sets __Host- HttpOnly Secure cookies on HTTPS requests', () => {
            const headers: Record<string, any> = {};
            const reply: any = {
                getHeader: (k: string) => headers[k.toLowerCase()],
                header: (k: string, v: any) => {
                    headers[k.toLowerCase()] = v;
                },
            };
            setUserSessionCookies(
                reply,
                { protocol: 'https', headers: { 'x-forwarded-proto': 'https' } },
                { accessToken: 'at-123', refreshToken: 'rt2.abc.def' },
            );

            const setCookies: string[] = headers['set-cookie'];
            expect(Array.isArray(setCookies)).toBe(true);
            expect(setCookies[0]).toContain('__Host-torex_at=at-123');
            expect(setCookies[0]).toContain('HttpOnly');
            expect(setCookies[0]).toContain('Secure');
            expect(setCookies[0]).toContain('SameSite=Lax');
            expect(setCookies[1]).toContain('__Host-torex_rt=');
            expect(setCookies[1]).toContain('SameSite=Strict');
        });
    });

    describe('Bidirectional ECDH P-256 Request Payload Envelope', () => {
        it('decrypts client-encrypted sensitive request envelopes and rejects tampered auth tags', () => {
            const serverBundle = getServerKemPublicBundle();
            const serverPubBuf = Buffer.from(serverBundle.pub, 'base64url');

            const clientEcdh = createECDH('prime256v1');
            const clientPubBuf = clientEcdh.generateKeys();
            const shared = clientEcdh.computeSecret(serverPubBuf);
            const iv = randomBytes(12);
            const aesKey = Buffer.from(
                hkdfSync('sha256', shared, iv, Buffer.from('torex-req-envelope-v1', 'utf8'), 32),
            );
            const aad = Buffer.concat([clientPubBuf, serverPubBuf, iv]);
            const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
            cipher.setAAD(aad);
            const payload = { login: '123456', pass: 'BrokerSecret!94', server: 'Exness-MT5Real' };
            const ct = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
            const tag = cipher.getAuthTag();

            const envelope = {
                _enc: 'ecdh-p256-aes256gcm-req-v1' as const,
                kid: serverBundle.kid,
                epk: clientPubBuf.toString('base64url'),
                iv: iv.toString('base64url'),
                tag: tag.toString('base64url'),
                ct: ct.toString('base64url'),
            };

            expect(isEncryptedRequestEnvelope(envelope)).toBe(true);
            const decrypted = decryptRequestEnvelopeFromClient(envelope);
            expect(decrypted).toEqual(payload);

            // Tampering tag must fail cleanly
            const tampered = { ...envelope, tag: randomBytes(16).toString('base64url') };
            expect(decryptRequestEnvelopeFromClient(tampered)).toBeNull();
        });
    });

    describe('AdminAuditService Immutable Hash-Chain', () => {
        it('maintains valid SHA-256 hash chain across entries and detects tampering', async () => {
            const audit = new AdminAuditService();
            await audit.record({
                adminEmail: 'admin@torexjournal.com',
                action: 'ADMIN_LOGIN_SUCCESS',
                targetType: 'session',
                targetId: 'jti-1',
                ip: '127.0.0.1',
            });
            await audit.record({
                adminEmail: 'admin@torexjournal.com',
                action: 'ADJUST_USER_SUBSCRIPTION',
                targetType: 'user',
                targetId: 'user-42',
                details: { planTier: 'PRO', days: 30 },
            });

            const listed = await audit.listLogs();
            expect(listed.items).toHaveLength(2);
            expect(listed.chainIntegrity).toEqual({ valid: true, checked: 2 });

            // Simulate database/memory tampering of an existing record
            (audit as any).memoryChain[0].action = 'TAMPERED_ACTION';
            const tamperedCheck = await audit.listLogs();
            expect(tamperedCheck.chainIntegrity.valid).toBe(false);
        });
    });

    describe('WorkerAuthGuard Dual-Key Rotation & Per-Request HMAC-SHA256', () => {
        const primaryKey = 'primary_worker_key_64_chars_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
        const previousKey = 'previous_worker_key_64_chars_99887766554433221100998877665544';

        const makeGuard = (strictHmac = true) => {
            const seenNonces = new Set<string>();
            const configService = {
                get: jest.fn((key: string) => {
                    if (key === 'NODE_ENV') return 'production';
                    if (key === 'WORKER_KEY') return primaryKey;
                    if (key === 'WORKER_KEY_PREVIOUS') return previousKey;
                    if (key === 'STRICT_WORKER_HMAC') return strictHmac ? 'true' : 'false';
                    return undefined;
                }),
            };
            const redisSecurity = {
                setIfAbsent: jest.fn(async (k: string) => {
                    if (seenNonces.has(k)) return false;
                    seenNonces.add(k);
                    return true;
                }),
            };
            return new WorkerAuthGuard(configService as any, redisSecurity as any);
        };

        const makeCtx = (req: any): any => ({
            switchToHttp: () => ({ getRequest: () => req }),
        });

        it('accepts valid HMAC-signed request with primary or previous rotated key and blocks replay nonce', async () => {
            const guard = makeGuard(true);
            const ts = String(Math.floor(Date.now() / 1000));
            const nonce = 'nonce_unique_001';
            const rawBody = Buffer.from(JSON.stringify({ workerId: 'win-01' }));
            const sig = computeWorkerRequestHmac(
                previousKey,
                'POST',
                '/api/v1/mt5-worker/heartbeat',
                ts,
                nonce,
                rawBody,
            );

            const req = {
                method: 'POST',
                url: '/api/v1/mt5-worker/heartbeat',
                rawBody,
                headers: {
                    'x-worker-id': 'win-01',
                    'x-worker-key': previousKey,
                    'x-worker-timestamp': ts,
                    'x-worker-nonce': nonce,
                    'x-worker-signature': `sha256=${sig}`,
                },
            };

            await expect(guard.canActivate(makeCtx(req))).resolves.toBe(true);
            // Replaying exact same nonce must be rejected
            await expect(guard.canActivate(makeCtx(req))).rejects.toThrow(UnauthorizedException);
        });

        it('rejects tampered request body or missing HMAC when STRICT_WORKER_HMAC=true', async () => {
            const guard = makeGuard(true);
            const ts = String(Math.floor(Date.now() / 1000));
            const sig = computeWorkerRequestHmac(
                primaryKey,
                'POST',
                '/api/v1/mt5-worker/heartbeat',
                ts,
                'nonce_002',
                '{"workerId":"win-01"}',
            );

            await expect(
                guard.canActivate(
                    makeCtx({
                        method: 'POST',
                        url: '/api/v1/mt5-worker/heartbeat',
                        rawBody: Buffer.from('{"workerId":"win-tampered"}'),
                        headers: {
                            'x-worker-id': 'win-01',
                            'x-worker-key': primaryKey,
                            'x-worker-timestamp': ts,
                            'x-worker-nonce': 'nonce_002',
                            'x-worker-signature': `sha256=${sig}`,
                        },
                    }),
                ),
            ).rejects.toThrow(UnauthorizedException);
        });
    });
});
