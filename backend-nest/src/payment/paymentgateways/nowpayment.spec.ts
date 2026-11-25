import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';
import { NowPaymentsService } from './nowpayment';

describe('NowPaymentsService', () => {
    const createService = (env: Record<string, string | undefined> = {}) => {
        const configService = {
            get: jest.fn((key: string) => env[key]),
        } as unknown as ConfigService;
        return new NowPaymentsService(configService);
    };

    it('resolves supported cryptocurrencies and aliases strictly', () => {
        const svc = createService();
        expect(svc.resolveCrypto('BTC').payCurrency).toBe('btc');
        expect(svc.resolveCrypto('usdt').symbol).toBe('USDT.TRC20');
        expect(svc.resolveCrypto('USDT.ERC20').payCurrency).toBe('usdterc20');
        expect(svc.resolveCrypto('bnb').symbol).toBe('BNB.BSC');
        expect(() => svc.resolveCrypto('FAKECOIN')).toThrow();
    });

    it('verifies NOWPayments HMAC-SHA512 IPN signature with recursive key sorting', () => {
        const secret = 'test-ipn-secret-12345';
        const svc = createService({ NOWPAYMENTS_IPN_SECRET: secret });

        const payload = {
            payment_status: 'finished',
            payment_id: 987654321,
            order_id: 'TOREX202611220001',
            meta: { z: 1, a: 2 },
        };

        const sorted = svc.sortObject(payload);
        const validSig = crypto
            .createHmac('sha512', secret)
            .update(JSON.stringify(sorted))
            .digest('hex');

        expect(svc.verifyIpnSignature(payload, validSig)).toEqual({ valid: true });
        expect(svc.verifyIpnSignature(payload, '00'.repeat(64)).valid).toBe(false);
        expect(svc.verifyIpnSignature(payload, '').reason).toBe('missing_signature');
    });

    it('never silently approves IPN when NOWPAYMENTS_IPN_SECRET is missing', () => {
        const svc = createService({});
        const res = svc.verifyIpnSignature({ payment_id: 1 }, 'abcd');
        expect(res.valid).toBe(false);
        expect(res.reason).toBe('missing_secret');
    });

    it('signs and verifies public wallet slip signatures securely', () => {
        const svc = createService({ NOWPAYMENTS_IPN_SECRET: 'slip-secret-key' });
        const ref = 'TOREX202611229999';
        const wallet = 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE';
        const sig = svc.generateSlipSignature(ref, wallet);

        expect(svc.verifySlipSignature(ref, wallet, sig)).toBe(true);
        expect(svc.verifySlipSignature(ref, 'TAttackerWalletAddress123456789012', sig)).toBe(false);
        expect(svc.verifySlipSignature('OTHER_REF', wallet, sig)).toBe(false);
    });

    it('generates local PNG QR code data URL without external services', async () => {
        const svc = createService();
        const dataUrl = await svc.generateQrDataUrl('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
        expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    });

    it('fetches full NOWPayments currency catalog and resolves dynamic coins via resolveCryptoAsync', async () => {
        const getSpy = jest.spyOn(axios, 'get').mockResolvedValueOnce({
            data: {
                currencies: [
                    { code: 'DOGE', name: 'Dogecoin', enable: true, network: 'Dogecoin', logo_url: '/images/coins/doge.svg' },
                    { code: 'DISABLEDCOIN', name: 'Disabled', enable: false, network: 'Test' },
                    { code: 'ADA', name: 'Cardano', enable: true, network: 'Cardano', logo_url: '/images/coins/ada.svg' },
                ],
            },
        } as any);

        try {
            const svc = createService({ NOWPAYMENTS_API_KEY: 'np-live-test-key' });
            const catalog = await svc.getSupportedCurrenciesCatalog();
            const doge = catalog.find((c) => c.symbol === 'DOGE');
            expect(doge).toBeDefined();
            expect(doge?.payCurrency).toBe('doge');
            expect(doge?.iconUrl).toBe('https://nowpayments.io/images/coins/doge.svg');
            expect(catalog.some((c) => c.symbol === 'DISABLEDCOIN')).toBe(false);

            const resolvedAda = await svc.resolveCryptoAsync('ada');
            expect(resolvedAda.symbol).toBe('ADA');
            expect(resolvedAda.displayName).toBe('Cardano');
            await expect(svc.resolveCryptoAsync('DISABLEDCOIN')).rejects.toThrow();
        } finally {
            getSpy.mockRestore();
        }
    });
});
