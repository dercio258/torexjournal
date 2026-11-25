import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { TurnstileService } from './turnstile.service';
import { RedisSecurityService } from './redis-security.service';
import { CloudflareR2StorageService } from './cloudflare-r2-storage.service';
import {
    canonicalizeForSignature,
    DigitalSignatureService,
} from './digital-signature.service';
import {
    hashPasswordSecure,
    needsPasswordRehash,
    verifyPasswordSecure,
} from './password-hash.util';
import { sanitizeInternalImageUrl } from './input-sanitizer.util';
import { AiPiiScrubberService } from '../../ai/ai-pii-scrubber.service';
import { AdminAuditService } from '../../admin/admin-audit.service';

function makeConfig(values: Record<string, string | undefined>): ConfigService {
    return {
        get: (key: string) => values[key],
    } as unknown as ConfigService;
}

describe('Phase P3 Security Hardening (Turnstile + Cloudflare R2 + Ed25519 Signatures + PII Scrubber + scrypt)', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    describe('Cloudflare Turnstile Anti-Bot Service', () => {
        it('bypasses cleanly when TURNSTILE_SECRET_KEY is not configured yet', async () => {
            const svc = new TurnstileService(makeConfig({}));
            expect(svc.isEnabled()).toBe(false);
            expect(svc.getPublicConfig()).toEqual({ enabled: false, siteKey: null });
            const res = await svc.verifyOrThrow(undefined, '198.51.100.1', 'login');
            expect(res.verified).toBe(true);
            expect(res.bypassed).toBe(true);
        });

        it('fails closed when enabled and token is missing', async () => {
            const svc = new TurnstileService(
                makeConfig({
                    TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
                    TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
                }),
            );
            expect(svc.getPublicConfig()).toEqual({
                enabled: true,
                siteKey: '1x00000000000000000000AA',
            });
            await expect(svc.verifyOrThrow('', '198.51.100.1', 'login')).rejects.toThrow(
                BadRequestException,
            );
        });

        it('verifies valid Cloudflare response and rejects single-use token replay', async () => {
            const redis = new RedisSecurityService(makeConfig({}));
            const svc = new TurnstileService(
                makeConfig({
                    TURNSTILE_SECRET_KEY: 'secret-turnstile-key',
                    TURNSTILE_SITE_KEY: 'site-turnstile-key',
                }),
                redis,
            );

            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    success: true,
                    hostname: 'torexjournal.com',
                    action: 'login',
                    challenge_ts: new Date().toISOString(),
                }),
            }) as any;

            const validToken = '0.valid_turnstile_response_token_1234567890';
            const first = await svc.verifyOrThrow(validToken, '203.0.113.5', 'login');
            expect(first.verified).toBe(true);
            expect(first.hostname).toBe('torexjournal.com');

            // Second attempt with the exact same token MUST be rejected as replay
            await expect(
                svc.verifyOrThrow(validToken, '203.0.113.5', 'login'),
            ).rejects.toThrow(BadRequestException);
        });

        it('rejects failed Cloudflare verification or mismatched action', async () => {
            const svc = new TurnstileService(
                makeConfig({
                    TURNSTILE_SECRET_KEY: 'secret-turnstile-key',
                }),
            );

            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    success: true,
                    action: 'register',
                }),
            }) as any;

            await expect(
                svc.verifyOrThrow('0.token_action_mismatch_987654321', '203.0.113.5', 'login'),
            ).rejects.toThrow(BadRequestException);
        });
    });

    describe('Cloudflare R2 Storage & SigV4 / HMAC Signed Media URLs', () => {
        it('mints valid AWS SigV4 Presigned GET URLs for R2 private buckets', () => {
            const r2 = new CloudflareR2StorageService(
                makeConfig({
                    R2_ACCOUNT_ID: 'acc123456789',
                    R2_ACCESS_KEY_ID: 'AKIA_TEST_R2_KEY',
                    R2_SECRET_ACCESS_KEY: 'super_secret_r2_signing_key_123456',
                    R2_PUBLIC_BUCKET: 'torex-public',
                    R2_PRIVATE_BUCKET: 'torex-private',
                    R2_PUBLIC_URL: 'https://cdn.torexjournal.com',
                    R2_PRESIGN_TTL_SECONDS: '300',
                }),
            );

            expect(r2.isR2Enabled()).toBe(true);
            const ownerTag = r2.computeOwnerTag('50f4649c-5380-4e2b-b2eb-b62feeb37466');
            // Raw user UUID must NOT appear in opaque owner tag
            expect(ownerTag).not.toContain('50f4649c');

            const key = `private/${ownerTag}/journal-screenshots/test-shot.png`;
            expect(r2.isPrivateKeyOwnedByUser(key, '50f4649c-5380-4e2b-b2eb-b62feeb37466')).toBe(true);
            expect(r2.isPrivateKeyOwnedByUser(key, 'other-user-id')).toBe(false);

            const signed = r2.createR2PresignedGetUrl(key, 300, new Date('2026-11-22T12:00:00.000Z'));
            expect(signed.provider).toBe('cloudflare-r2');
            expect(signed.signatureAlg).toBe('AWS4-HMAC-SHA256');
            expect(signed.url).toContain('https://acc123456789.r2.cloudflarestorage.com/torex-private/');
            expect(signed.url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
            expect(signed.url).toContain('X-Amz-Expires=300');
            expect(signed.url).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);
        });

        it('issues and verifies expiring HMAC-SHA256 local gateway signatures and rejects tampering', () => {
            const r2 = new CloudflareR2StorageService(
                makeConfig({
                    MEDIA_SIGNING_SECRET: 'test-media-hmac-secret-32-chars-minimum',
                }),
            );
            expect(r2.isR2Enabled()).toBe(false);

            const ownerTag = r2.computeOwnerTag('user-abc');
            const key = `private/${ownerTag}/backtest-screenshots/chart.webp`;
            const signed = r2.createSignedPrivateAccessUrl(key, 300);
            expect(signed.signatureAlg).toBe('HMAC-SHA256');

            const parsed = new URL(`https://torexjournal.com${signed.url}`);
            const exp = parsed.searchParams.get('exp')!;
            const sig = parsed.searchParams.get('sig')!;

            expect(r2.verifyGatewaySignature(key, exp, sig)).toBe(true);
            // Tampered key rejected
            expect(r2.verifyGatewaySignature(`${key}.evil`, exp, sig)).toBe(false);
            // Expired timestamp rejected
            expect(r2.verifyGatewaySignature(key, Math.floor(Date.now() / 1000) - 10, sig)).toBe(false);
            // Tampered signature rejected
            expect(r2.verifyGatewaySignature(key, exp, `${sig}x`)).toBe(false);
        });

        it('allows R2 public URLs and private media gateway paths in sanitizeInternalImageUrl while blocking untrusted hosts', () => {
            expect(
                sanitizeInternalImageUrl('/api/media/private/private/abc123/journal-screenshots/img.png'),
            ).toBe('/api/media/private/private/abc123/journal-screenshots/img.png');
            expect(
                sanitizeInternalImageUrl('https://pub-12345.r2.dev/avatars/uuid.webp'),
            ).toBe('https://pub-12345.r2.dev/avatars/uuid.webp');
            expect(sanitizeInternalImageUrl('https://evil.example.com/tracker.png')).toBeUndefined();
            expect(sanitizeInternalImageUrl('/api/media/private/../../etc/passwd')).toBeUndefined();
        });
    });

    describe('Ed25519 Digital Signatures & Signed Admin Audit Checkpoints', () => {
        it('signs and verifies performance reports independent of JSON key order and detects tampering', () => {
            const signer = new DigitalSignatureService(makeConfig({}));
            const pub = signer.getPublicKeyBundle();
            expect(pub.alg).toBe('Ed25519');
            expect(pub.publicKeyPem).toContain('-----BEGIN PUBLIC KEY-----');

            const reportA = {
                period: '2026-11',
                summary: { netPnl: 2450.75, winRate: 64.2, totalTrades: 42 },
                account: 'Main MT5',
            };
            // Identical logical content with different key order
            const reportReordered = {
                account: 'Main MT5',
                summary: { totalTrades: 42, winRate: 64.2, netPnl: 2450.75 },
                period: '2026-11',
            };
            expect(canonicalizeForSignature(reportA)).toBe(canonicalizeForSignature(reportReordered));

            const envelope = signer.signCanonicalPayload(reportA, 'performance_report');
            expect(envelope.alg).toBe('Ed25519');
            expect(envelope.kid).toBe(pub.kid);

            // Verifies cleanly even with reordered keys
            const verified = signer.verifySignedEnvelope({
                payload: reportReordered,
                envelope,
            });
            expect(verified.valid).toBe(true);
            expect(verified.purpose).toBe('performance_report');

            // Tampering with even 1 cent invalidates the signature
            const tampered = {
                ...reportA,
                summary: { ...reportA.summary, netPnl: 9999.99 },
            };
            const tamperedRes = signer.verifySignedEnvelope({
                payload: tampered,
                envelope,
            });
            expect(tamperedRes.valid).toBe(false);
            expect(tamperedRes.reason).toBe('CONTENT_HASH_MISMATCH');

            // Tampering with signature bytes fails verification
            const forgedSig = signer.verifySignedEnvelope({
                payload: reportA,
                envelope: { ...envelope, signature: 'AAAA'.repeat(20) },
            });
            expect(forgedSig.valid).toBe(false);
        });

        it('attaches verifiable Ed25519 signedCheckpoint to AdminAuditService logs', async () => {
            const signer = new DigitalSignatureService(makeConfig({}));
            const audit = new AdminAuditService(undefined, signer);

            await audit.record({
                adminEmail: 'sec@torexjournal.com',
                action: 'USER_SUSPENDED',
                targetType: 'user',
                targetId: 'u-123',
                details: { reason: 'abuse' },
            });

            const res = await audit.listLogs();
            expect(res.chainIntegrity.valid).toBe(true);
            expect(res.signedCheckpoint).toBeDefined();
            expect(res.signedCheckpoint?.alg).toBe('Ed25519');
            expect(res.signedCheckpoint?.purpose).toBe('audit_checkpoint');

            const verifyCheckpoint = signer.verifySignedEnvelope({
                contentHashSha256: res.signedCheckpoint!.contentHashSha256,
                envelope: res.signedCheckpoint,
            });
            expect(verifyCheckpoint.valid).toBe(true);
        });
    });

    describe('AI Outbound PII Scrubber', () => {
        it('scrubs PII and secrets while preserving trading metrics, symbols, and PnL values', () => {
            const scrubber = new AiPiiScrubberService();
            const prompt =
                'Analisa meu XAUUSD (+$1,250.40, win rate 62.5% em 2026-11-20). ' +
                'Meu email é trader@example.com, whatsapp +258 843357697, ' +
                'token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456, ' +
                'senha=SuperSecret99!';

            const res = scrubber.scrubOutboundText(prompt);
            expect(res.redactionsCount).toBeGreaterThanOrEqual(4);
            expect(res.text).toContain('XAUUSD');
            expect(res.text).toContain('+$1,250.40');
            expect(res.text).toContain('62.5%');
            expect(res.text).toContain('2026-11-20');
            expect(res.text).not.toContain('trader@example.com');
            expect(res.text).not.toContain('843357697');
            expect(res.text).not.toContain('eyJhbGciOi');
            expect(res.text).not.toContain('SuperSecret99!');
            expect(res.text).toContain('[EMAIL_REDACTED]');
            expect(res.text).toContain('[PHONE_REDACTED]');
            expect(res.text).toContain('[SECRET_REDACTED]');
            expect(res.text).toContain('[CREDENTIAL_REDACTED]');
        });
    });

    describe('Memory-Hard scrypt Password Hashing with Legacy bcrypt Compatibility', () => {
        it('hashes and verifies with $scrypt$v1$ and transparently detects legacy bcrypt hashes for rehash', async () => {
            const scryptHash = await hashPasswordSecure('Torex!Strong#2026');
            expect(scryptHash.startsWith('$scrypt$v1$')).toBe(true);
            expect(needsPasswordRehash(scryptHash)).toBe(false);
            expect(await verifyPasswordSecure('Torex!Strong#2026', scryptHash)).toBe(true);
            expect(await verifyPasswordSecure('WrongPassword!1', scryptHash)).toBe(false);

            const legacyBcrypt = await bcrypt.hash('LegacyPass!99', 8);
            expect(needsPasswordRehash(legacyBcrypt)).toBe(true);
            expect(await verifyPasswordSecure('LegacyPass!99', legacyBcrypt)).toBe(true);
            expect(await verifyPasswordSecure('WrongPass', legacyBcrypt)).toBe(false);
        });
    });
});
