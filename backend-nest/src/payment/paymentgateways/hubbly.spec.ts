import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
    HubblyService,
    isValidCnpj,
    isValidCpf,
    validateCpfOrCnpj,
} from './hubbly';

describe('HubblyService (PIX)', () => {
    const createService = (env: Record<string, string | undefined> = {}) => {
        const configService = {
            get: jest.fn((key: string) => env[key]),
        } as unknown as ConfigService;
        return new HubblyService(configService);
    };

    it('validates Brazilian CPF and CNPJ check digits accurately', () => {
        // Valid generated test CPF & CNPJ
        expect(isValidCpf('52998224725')).toBe(true);
        expect(isValidCpf('529.982.247-25')).toBe(true);
        expect(isValidCpf('111.111.111-11')).toBe(false);
        expect(isValidCpf('52998224726')).toBe(false);

        expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
        expect(isValidCnpj('11222333000181')).toBe(true);
        expect(isValidCnpj('00.000.000/0000-00')).toBe(false);
        expect(isValidCnpj('11.222.333/0001-82')).toBe(false);

        const cnpjRes = validateCpfOrCnpj('11.222.333/0001-81');
        expect(cnpjRes.valid).toBe(true);
        expect(cnpjRes.type).toBe('CNPJ');
        expect(cnpjRes.masked).toBe('**.222.333/0001-**');

        const cpfRes = validateCpfOrCnpj('529.982.247-25');
        expect(cpfRes.valid).toBe(true);
        expect(cpfRes.type).toBe('CPF');
        expect(cpfRes.masked).toBe('***.982.247-**');
    });

    it('verifies Hubbly v2 HMAC-SHA256 webhook signature and anti-replay timestamp', () => {
        const secret = 'whsec_test_hubbly_secret';
        const svc = createService({ HUBBLY_WEBHOOK_SECRET: secret });

        const rawBody = Buffer.from(JSON.stringify({ externalId: 'TOREX123', status: 'paid' }), 'utf8');
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = crypto
            .createHmac('sha256', secret)
            .update(`${ts}.`)
            .update(rawBody)
            .digest('hex');

        expect(
            svc.verifyWebhookSignature(rawBody, {
                'x-webhook-timestamp': ts,
                'x-webhook-signature': sig,
            }),
        ).toEqual({ valid: true });

        // Reject tampered body
        expect(
            svc.verifyWebhookSignature(Buffer.from('{"externalId":"HACK"}', 'utf8'), {
                'x-webhook-timestamp': ts,
                'x-webhook-signature': sig,
            }).valid,
        ).toBe(false);

        // Reject stale timestamp (> 5 min)
        const oldTs = String(Math.floor(Date.now() / 1000) - 600);
        const oldSig = crypto
            .createHmac('sha256', secret)
            .update(`${oldTs}.`)
            .update(rawBody)
            .digest('hex');
        expect(
            svc.verifyWebhookSignature(rawBody, {
                'x-webhook-timestamp': oldTs,
                'x-webhook-signature': oldSig,
            }).reason,
        ).toBe('expired_timestamp');
    });

    it('never silently approves webhook when HUBBLY_WEBHOOK_SECRET is missing', () => {
        const svc = createService({});
        const res = svc.verifyWebhookSignature('{}', {
            'x-webhook-timestamp': String(Math.floor(Date.now() / 1000)),
            'x-webhook-signature': 'a'.repeat(64),
        });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe('missing_secret');
    });

    it('generates crisp local PNG QR Code data URL from PIX EMV payload', async () => {
        const svc = createService();
        const qr = await svc.generateQrDataUrl('00020126360014br.gov.bcb.pix0114+55119999999995204000053039865802BR5913TOREX JOURNAL6009SAO PAULO62070503***6304ABCD');
        expect(qr.startsWith('data:image/png;base64,')).toBe(true);
    });
});
