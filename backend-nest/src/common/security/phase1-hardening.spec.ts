import { createCipheriv, createHmac, randomBytes, scryptSync } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { CryptoUtil } from '../utils/crypto.util';
import { buildSessionCacheKey } from './security.config';
import {
    sanitizeCsvCell,
    sanitizeInternalImageUrl,
    sanitizeJournalPayload,
    sanitizePlainText,
    sanitizeRichHtml,
} from './input-sanitizer.util';
import { WebhookController } from '../../payment/webhook.controller';

describe('Phase P1 Security Hardening', () => {
    describe('CryptoUtil v3 (HKDF-SHA256 + AES-256-GCM + kid + AAD + rotation)', () => {
        const keyringV1 = {
            activeKid: 'k1',
            keys: { k1: 'super-strong-primary-key-material-2026-v1' },
        };
        const keyringRotated = {
            activeKid: 'k2',
            keys: {
                k2: 'brand-new-rotated-primary-key-material-2026-v2',
                k1: 'super-strong-primary-key-material-2026-v1',
            },
        };

        it('encrypts with v3 HKDF+AAD, rejects tampered AAD across tenants, and supports zero-downtime key rotation', () => {
            const ct = CryptoUtil.encrypt('mt5-broker-secret-99', keyringV1, {
                aad: 'mt5:user-A:123456',
            });

            expect(ct.startsWith('v3:k1:')).toBe(true);
            expect(
                CryptoUtil.decrypt(ct, keyringV1, { aad: 'mt5:user-A:123456' }),
            ).toBe('mt5-broker-secret-99');

            // Tenant-swap / tampered AAD must fail GCM auth tag verification
            expect(() =>
                CryptoUtil.decrypt(ct, keyringV1, { aad: 'mt5:user-B:123456' }),
            ).toThrow();

            // Keyring rotation cleanly decrypts old k1 ciphertext and flags lazy re-encryption
            expect(
                CryptoUtil.decrypt(ct, keyringRotated, { aad: 'mt5:user-A:123456' }),
            ).toBe('mt5-broker-secret-99');
            expect(CryptoUtil.needsReencryption(ct, 'k2')).toBe(true);
            expect(CryptoUtil.needsReencryption(ct, 'k1')).toBe(false);
        });

        it('remains backwards-compatible with legacy v2 scryptSync ciphertexts', () => {
            const secret = 'legacy-secret-key-32-chars-minimum';
            const salt = randomBytes(16);
            const iv = randomBytes(12);
            const key = scryptSync(secret, salt, 32);
            const cipher = createCipheriv('aes-256-gcm', key, iv);
            const encrypted = Buffer.concat([
                cipher.update('legacy-deriv-token', 'utf8'),
                cipher.final(),
            ]);
            const tag = cipher.getAuthTag();
            const v2Ciphertext = `v2:${salt.toString('hex')}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;

            expect(CryptoUtil.decrypt(v2Ciphertext, secret)).toBe('legacy-deriv-token');
            expect(CryptoUtil.needsReencryption(v2Ciphertext, 'k1')).toBe(true);
        });

        it('performs non-blocking HKDF v3 decrypt rapidly (< 5ms per op)', () => {
            const ct = CryptoUtil.encrypt('benchmark-payload', keyringV1, {
                aad: 'totp:user-1',
            });
            const start = Date.now();
            for (let i = 0; i < 20; i++) {
                expect(CryptoUtil.decrypt(ct, keyringV1, { aad: 'totp:user-1' })).toBe(
                    'benchmark-payload',
                );
            }
            expect(Date.now() - start).toBeLessThan(100);
        });
    });

    describe('Input Sanitizer (Stored XSS, Internal Image URL, CSV Formula Injection)', () => {
        it('strips script tags, nested script evasion, event handlers, svg, and javascript URIs', () => {
            const dirty =
                '<p>Trade <b>EURUSD</b></p><scr<script>ipt>alert(1)</script><img src="x" onerror="fetch(\'https://evil.com\')"><a href="javascript:alert(2)">click</a><svg onload=alert(3)></svg>';
            const clean = sanitizeRichHtml(dirty);

            expect(clean).toContain('<p>Trade <b>EURUSD</b></p>');
            expect(clean).not.toMatch(/<script|onerror|onload|javascript:|<svg/i);
        });

        it('strips all HTML in plain text fields', () => {
            expect(sanitizePlainText('<b>Hello</b> <script>x()</script>World')).toBe('Hello World');
        });

        it('allows only internal /uploads or canonical torexjournal.com image URLs', () => {
            expect(sanitizeInternalImageUrl('/uploads/abc123.png')).toBe('/uploads/abc123.png');
            expect(
                sanitizeInternalImageUrl('https://torexjournal.com/uploads/chart.webp'),
            ).toBe('https://torexjournal.com/uploads/chart.webp');
            expect(sanitizeInternalImageUrl('https://evil.attacker.com/pixel.png')).toBeUndefined();
            expect(sanitizeInternalImageUrl('/uploads/../../etc/passwd')).toBeUndefined();
            expect(sanitizeInternalImageUrl('javascript:alert(1)')).toBeUndefined();
        });

        it('neutralizes CSV Formula Injection prefixes', () => {
            expect(sanitizeCsvCell('=CMD|\' /C calc\'!A0')).toBe("'=CMD|' /C calc'!A0");
            expect(sanitizeCsvCell('+SUM(A1:A9)')).toBe("'+SUM(A1:A9)");
            expect(sanitizeCsvCell('-2+3')).toBe("'-2+3");
            expect(sanitizeCsvCell('@HYPERLINK("http://evil")')).toBe('\'@HYPERLINK("http://evil")');
            expect(sanitizeCsvCell('XAUUSD')).toBe('XAUUSD');
        });

        it('sanitizes rich text fields inside journal payloads', () => {
            const res = sanitizeJournalPayload({
                title: '<script>x()</script>Plano NY',
                content: '<p>Setup SMC</p><iframe src="https://evil.com"></iframe>',
                accountId: 'acc-1',
            });
            expect(res.title).toBe('Plano NY');
            expect(res.content).toBe('<p>Setup SMC</p>');
            expect(res.accountId).toBe('acc-1');
        });
    });

    describe('Session Redis Key Hashing', () => {
        it('hashes JWT tokens with SHA-256 and never exposes raw JWT in key', () => {
            const fakeJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6InVzZXItMSJ9.signature123';
            const key = buildSessionCacheKey(fakeJwt);
            expect(key.startsWith('user_session:sha256:')).toBe(true);
            expect(key).not.toContain('eyJhbGci');
            expect(key).not.toContain('signature123');
            expect(key.length).toBe('user_session:sha256:'.length + 64);
        });
    });

    describe('WebhookController Anti-Replay & Atomic Event-ID Idempotency', () => {
        const secret = 'test_webhook_secret_64_chars_long';
        const makeController = (seenKeys = new Set<string>()) => {
            const subService = { processPaymentWebhook: jest.fn(async () => undefined) };
            const configService = {
                get: jest.fn((k: string, d?: string) => {
                    if (k === 'WEBHOOK_SECRET') return secret;
                    if (k === 'NODE_ENV') return 'production';
                    return d;
                }),
            };
            const redisSecurity = {
                setIfAbsent: jest.fn(async (key: string) => {
                    if (seenKeys.has(key)) return false;
                    seenKeys.add(key);
                    return true;
                }),
            };
            return {
                controller: new WebhookController(
                    subService as any,
                    configService as any,
                    redisSecurity as any,
                ),
                subService,
            };
        };

        it('rejects replayed webhooks with stale timestamp (> 5 minutes skew)', async () => {
            const { controller, subService } = makeController();
            const body = { event_id: 'evt_stale_1', reference: 'REF-1', status: 'PAID' };
            const rawBody = Buffer.from(JSON.stringify(body));
            const sig = createHmac('sha256', secret).update(rawBody).digest('hex');
            const staleTs = String(Math.floor((Date.now() - 10 * 60 * 1000) / 1000));

            await expect(
                controller.handleWebhook({ rawBody }, body, sig, staleTs),
            ).rejects.toThrow(UnauthorizedException);
            expect(subService.processPaymentWebhook).not.toHaveBeenCalled();
        });

        it('deduplicates repeated webhook deliveries atomically without double-processing', async () => {
            const seen = new Set<string>();
            const { controller, subService } = makeController(seen);
            const body = { event_id: 'evt_dup_42', reference: 'REF-42', status: 'PAID' };
            const rawBody = Buffer.from(JSON.stringify(body));
            const sig = createHmac('sha256', secret).update(rawBody).digest('hex');
            const freshTs = String(Math.floor(Date.now() / 1000));

            const first = await controller.handleWebhook({ rawBody }, body, sig, freshTs);
            const second = await controller.handleWebhook({ rawBody }, body, sig, freshTs);

            expect(first).toEqual({ success: true });
            expect(second).toEqual({ success: true, duplicate: true });
            expect(subService.processPaymentWebhook).toHaveBeenCalledTimes(1);
        });
    });
});
