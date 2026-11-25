import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { DebitoPayService } from './debitopay.service';
import { CheckoutGeoIpService } from '../checkout-geoip.service';

describe('DebitoPayService & CheckoutGeoIpService', () => {
    const createDebito = (env: Record<string, string | undefined> = {}) => {
        const configService = {
            get: jest.fn((key: string) => env[key]),
        } as unknown as ConfigService;
        return new DebitoPayService(configService);
    };

    it('verifies Debito Pay HMAC-SHA256 webhook signature strictly', () => {
        const secret = 'debito_webhook_secret_xyz';
        const svc = createDebito({ DEBITO_PAY_WEBHOOK_SECRET: secret });
        const rawBody = Buffer.from(
            JSON.stringify({ event: 'payment.completed', data: { payment_id: 'p1', reference: 'TOREX1' } }),
            'utf8',
        );
        const validSig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

        expect(svc.verifyWebhookSignature(rawBody, validSig)).toEqual({ valid: true });
        expect(svc.verifyWebhookSignature(rawBody, `sha256=${validSig}`)).toEqual({ valid: true });
        expect(svc.verifyWebhookSignature(rawBody, '00'.repeat(32)).valid).toBe(false);
        expect(svc.verifyWebhookSignature(rawBody, '').reason).toBe('missing_signature');
    });

    it('resolves per-method DEBITO_PAY_WALLET_* variables, legacy fallbacks, and orchestrator endpoint', () => {
        const canonical = createDebito({
            DEBITO_PAY_WALLET_EMOLA: 'W_EMOLA',
            DEBITO_PAY_WALLET_MPESA: 'W_MPESA',
            DEBITO_PAY_WALLET_CARD: 'W_CARD',
            DEBITO_PAY_WALLET_PAYFAST: 'W_PAYFAST',
            DEBITO_PAY_ENDPOINT: 'https://custom.debito.test/functions/v1/payment-orchestrator/',
            DEBITO_PAY_WEBHOOK_URL: 'https://torexjournal.com/api/webhooks/debito-pay',
        });

        expect(canonical.getWalletCode('emola')).toBe('W_EMOLA');
        expect(canonical.getWalletCode('mpesa')).toBe('W_MPESA');
        expect(canonical.getWalletCode('visa_mastercard')).toBe('W_CARD');
        expect(canonical.getWalletCode('payfast')).toBe('W_PAYFAST');
        expect(canonical.getOrchestratorEndpoint()).toBe(
            'https://custom.debito.test/functions/v1/payment-orchestrator',
        );
        expect(canonical.getWebhookEndpoint()).toBe(
            'https://torexjournal.com/api/webhooks/debito-pay',
        );

        const legacy = createDebito({
            DEBITO_WALLET_ID_MPESA: 'W_MZN_1',
            DEBITO_WALLET_ID_EMOLA: 'W_MZN_2',
            DEBITO_WALLET_ID_CARD: 'W_MZN_3',
            DEBITO_WALLET_PAYFAST: 'W_ZAR_9',
        });

        expect(legacy.getWalletCode('mpesa')).toBe('W_MZN_1');
        expect(legacy.getWalletCode('emola')).toBe('W_MZN_2');
        expect(legacy.getWalletCode('visa_mastercard')).toBe('W_MZN_3');
        expect(legacy.getWalletCode('payfast')).toBe('W_ZAR_9');
    });

    it('maps GeoIP country codes strictly to adaptive checkout methods', () => {
        const configService = { get: jest.fn(() => undefined) } as unknown as ConfigService;
        const geo = new CheckoutGeoIpService(configService);

        expect(geo.buildMethodsForCountry('MZ').availableMethods).toEqual([
            'mpesa',
            'emola',
            'card',
            'crypto',
        ]);
        expect(geo.buildMethodsForCountry('BR').availableMethods).toEqual([
            'pix',
            'card',
            'crypto',
        ]);
        expect(geo.buildMethodsForCountry('ZA').availableMethods).toEqual([
            'payfast',
            'card',
            'crypto',
        ]);
        expect(geo.buildMethodsForCountry('US').availableMethods).toEqual(['card', 'crypto']);
        expect(geo.buildMethodsForCountry('PT').availableMethods).toEqual(['card', 'crypto']);
    });

    it('resolves checkout GeoIP from trusted CDN headers without relying on user profile', async () => {
        const configService = { get: jest.fn(() => undefined) } as unknown as ConfigService;
        const geo = new CheckoutGeoIpService(configService);

        const mz = await geo.resolveFromRequest({ headers: { 'cf-ipcountry': 'MZ' } });
        expect(mz.countryCode).toBe('MZ');
        expect(mz.availableMethods).toContain('mpesa');
        expect(mz.availableMethods).toContain('emola');
        expect(mz.availableMethods).not.toContain('pix');
        expect(mz.availableMethods).not.toContain('payfast');

        const br = await geo.resolveFromRequest({ headers: { 'cf-ipcountry': 'BR' } });
        expect(br.countryCode).toBe('BR');
        expect(br.availableMethods).toEqual(['pix', 'card', 'crypto']);

        const za = await geo.resolveFromRequest({ headers: { 'x-vercel-ip-country': 'ZA' } });
        expect(za.countryCode).toBe('ZA');
        expect(za.availableMethods).toEqual(['payfast', 'card', 'crypto']);
    });
});
