import {
    EmailTemplateName,
    EmailTemplatePayloadMap,
    EmailTemplateRegistry,
    renderEmailTemplate,
} from './index';

describe('Institutional Email Templates Registry (18 Situations)', () => {
    const samplePayloads: { [K in EmailTemplateName]: EmailTemplatePayloadMap[K] } = {
        OTP_CODE: {
            otp: '482910',
            userName: 'Carlos Silva',
            expiresInMinutes: 5,
            purpose: 'TWO_FACTOR',
        },
        WELCOME_EMAIL: {
            userName: 'Carlos Silva',
            dashboardUrl: 'https://torexjournal.com/dashboard',
        },
        LOGIN_ALERT: {
            userName: 'Carlos Silva',
            ip: '197.218.44.12',
            device: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
            time: '12/11/2026 09:15',
        },
        PASSWORD_RECOVERY: {
            userName: 'Carlos Silva',
            code: '739104',
            resetUrl:
                'https://torexjournal.com/forgot-password?recover=true&email=carlos%40example.com&token=abc&sig=def',
            expiresInMinutes: 15,
        },
        ACCOUNT_LOCKED: {
            userName: 'Carlos Silva',
            code: '918273',
            unlockUrl:
                'https://torexjournal.com/forgot-password?recover=true&email=carlos%40example.com&token=abc&sig=def',
            failedAttempts: 9,
            expiresInMinutes: 15,
        },
        PAYMENT_INITIATED: {
            userName: 'Carlos Silva',
            plan: 'PRO',
            amount: 1200,
            currency: 'MZN',
            method: 'mpesa',
            reference: 'TOREX2026111209001234',
        },
        CRYPTO_PAYMENT_INITIATED: {
            userName: 'Carlos Silva',
            plan: 'PRO',
            cycle: 'Mensal',
            amountUsd: 15.99,
            cryptoAmount: '15.99',
            cryptoCurrency: 'USDT.TRC20',
            displayName: 'Tether USD (TRC20)',
            network: 'TRON (TRC20)',
            walletAddress: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
            reference: 'TOREX2026111209009876',
            copyWalletUrl: 'https://torexjournal.com/pay/crypto/TOREX2026111209009876?sig=abc123&copy=1',
            checkoutUrl: 'https://torexjournal.com/checkout?cryptoRef=TOREX2026111209009876',
            expiresAt: '2026-11-12T10:00:00.000Z',
        },
        PAYMENT_SUCCESS: {
            userName: 'Carlos Silva',
            plan: 'PRO',
            cycle: 'Mensal',
            amount: 1200,
            currency: 'MZN',
            reference: 'TOREX2026111209001234',
            expiryDate: '2026-12-12T09:00:00.000Z',
        },
        PAYMENT_FAILED: {
            userName: 'Carlos Silva',
            plan: 'PRO',
            reference: 'TOREX2026111209001234',
            reason: 'Saldo insuficiente na carteira móvel.',
        },
        TRIAL_WELCOME: {
            userName: 'Carlos Silva',
            plan: 'PRO',
            days: 14,
            expiryDate: '2026-11-26T09:00:00.000Z',
            dashboardUrl: 'https://torexjournal.com/dashboard',
        },
        SUBSCRIPTION_EXPIRING: {
            userName: 'Carlos Silva',
            plan: 'PRO',
            daysRemaining: 5,
            expiryDate: '2026-11-17T09:00:00.000Z',
        },
        SUBSCRIPTION_EXPIRED: {
            userName: 'Carlos Silva',
            plan: 'PRO',
            expiredAt: '2026-11-12T09:00:00.000Z',
        },
        SUBSCRIPTION_CANCELLED: {
            userName: 'Carlos Silva',
            plan: 'PRO',
            effectiveDate: '2026-11-12T09:00:00.000Z',
            reason: 'Solicitação administrativa',
        },
        REMARKETING_FOLLOWUP: {
            userName: 'Carlos Silva',
            plan: 'PRO',
        },
        MT5_STATUS: {
            userName: 'Carlos Silva',
            mt5Id: '6371945',
            broker: 'Deriv-Server',
            status: 'DISCONNECTED',
        },
        TRADE_IMPORTED: {
            userName: 'Carlos Silva',
            count: 24,
            method: 'FILE',
            profit: 412.5,
            currency: 'USD',
            wins: 16,
            losses: 8,
            accountName: 'FTMO 100k',
        },
        WEEKLY_SUMMARY: {
            userName: 'Carlos Silva',
            totalPnL: 1285.4,
            currency: 'USD',
            winRate: 68.4,
            totalTrades: 19,
            topLessons: [
                { lesson: 'Aguardar fechamento do candle de 15m na abertura de NY', count: 4 },
            ],
            period: { start: '2026-11-02', end: '2026-11-08' },
        },
        MONTHLY_SUMMARY: {
            userName: 'Carlos Silva',
            totalPnL: 3412.8,
            currency: 'USD',
            winRate: 64.5,
            totalTrades: 62,
            topLessons: [
                { lesson: 'Respeitar limite de perda diário em dias de notícia', count: 5 },
            ],
            period: { start: '2026-10-22', end: '2026-11-21' },
        },
        SYSTEM_ALERT: {
            userName: 'Carlos Silva',
            title: 'Limite Diário de Perda Atingido',
            message: 'O drawdown diário atingiu 3.1% sobre o saldo inicial da conta.',
            type: 'RISK',
        },
        GENERAL_NOTIFICATION: {
            userName: 'Carlos Silva',
            title: 'Atualização Programada de Infraestrutura',
            subtitle: 'Comunicado Técnico',
            message: 'Realizaremos manutenção preventiva no domingo às **02:00 UTC**.\nO acesso ao painel permanecerá disponível.',
            buttonLabel: 'Ver Painel',
            buttonUrl: '/dashboard',
        },
    };

    const allTemplateNames = Object.keys(EmailTemplateRegistry) as EmailTemplateName[];

    it('registers all 20 institutional templates', () => {
        expect(allTemplateNames).toHaveLength(20);
    });

    it.each(allTemplateNames)(
        'renders %s with valid routes, plain-text fallback, and zero visual clutter',
        (templateName) => {
            const rendered = renderEmailTemplate(
                templateName,
                samplePayloads[templateName] as any,
            );

            expect(rendered.subject.length).toBeGreaterThan(10);
            expect(rendered.preheader.length).toBeGreaterThan(10);
            expect(rendered.html).toContain('<!DOCTYPE html>');
            expect(rendered.html).toContain('TOREX');
            expect(rendered.text.length).toBeGreaterThan(40);

            // Must never contain legacy broken routes or placeholder anchors
            expect(rendered.html).not.toContain('href="#"');
            expect(rendered.html).not.toContain('/settings"');
            expect(rendered.html).not.toContain('/subscription"');
            expect(rendered.html).not.toContain('/dashboard/dashboard');

            // Must never leak raw Markdown bold asterisks or pointer emojis
            expect(rendered.html).not.toContain('**');
            expect(rendered.subject).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
        },
    );

    it('escapes untrusted HTML payloads against XSS injection', () => {
        const rendered = renderEmailTemplate('LOGIN_ALERT', {
            userName: '<script>alert(1)</script>',
            ip: '10.0.0.1',
            device: '<img src=x onerror=alert(1)>',
            time: '12/11/2026',
        });

        expect(rendered.html).not.toContain('<script>');
        expect(rendered.html).not.toContain('<img src=x');
        expect(rendered.html).toContain('&lt;script&gt;');
    });

    it('uses exact OTP expiration minutes and USD account currency instead of hardcoded MT', () => {
        const otp5 = renderEmailTemplate('OTP_CODE', {
            otp: '112233',
            expiresInMinutes: 5,
            purpose: 'TWO_FACTOR',
        });
        expect(otp5.html).toContain('Válido por 5 minutos');

        const tradeSummary = renderEmailTemplate('TRADE_IMPORTED', {
            count: 5,
            method: 'FILE',
            profit: 250,
            currency: 'USD',
        });
        expect(tradeSummary.html).toContain('+USD 250,00');
        expect(tradeSummary.html).not.toContain('250.00 MT');
    });

    it('renders CRYPTO_PAYMENT_INITIATED with inline QR CID, wallet address, and copy wallet button', () => {
        const rendered = renderEmailTemplate('CRYPTO_PAYMENT_INITIATED', {
            userName: 'Carlos Silva',
            plan: 'PRO',
            cycle: 'Mensal',
            amountUsd: 15.99,
            cryptoAmount: '15.99',
            cryptoCurrency: 'USDT.TRC20',
            displayName: 'Tether USD (TRC20)',
            network: 'TRON (TRC20)',
            walletAddress: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
            reference: 'TOREX2026111209009876',
            copyWalletUrl: 'https://torexjournal.com/pay/crypto/TOREX2026111209009876?sig=abc123&copy=1',
            checkoutUrl: 'https://torexjournal.com/checkout?cryptoRef=TOREX2026111209009876',
        });

        expect(rendered.inlineQr?.cid).toBe('crypto-payment-qr@torexjournal.com');
        expect(rendered.inlineQr?.data).toBe('TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE');
        expect(rendered.html).toContain('cid:crypto-payment-qr@torexjournal.com');
        expect(rendered.html).toContain('TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE');
        expect(rendered.html).toContain('Copiar ID da Carteira');
    });
});
