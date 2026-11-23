import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_CRYPTO_CURRENCIES,
    filterCryptoCurrencies,
    getPaymentMethodGridClass,
    PAYMENT_METHOD_ICON_PATHS,
    PAYFAST_COMPILED_ICONS,
    resolveLocationOption,
    type CryptoCurrencyOption,
} from '../src/components/subscription/CheckoutFlow.tsx';
import {
    buildCheckoutFailureUrl,
    computeAdaptivePollDelay,
    detectCallbackFailureFromSearch,
    parseRetryAfterHeader,
    resolvePaymentFailureCopy,
} from '../src/lib/paymentPolling.ts';
import { resolvePricingModalCloseAction } from '../src/lib/planGate.ts';

test('filterCryptoCurrencies matches by symbol, name, network, and multi-token queries', () => {
    const extended: CryptoCurrencyOption[] = [
        ...DEFAULT_CRYPTO_CURRENCIES,
        {
            symbol: 'DOGE',
            payCurrency: 'doge',
            displayName: 'Dogecoin (DOGE)',
            shortName: 'DOGE',
            network: 'Dogecoin Network',
            iconUrl: 'https://nowpayments.io/images/coins/doge.svg',
            methodSlug: 'doge',
        },
        {
            symbol: 'ADA',
            payCurrency: 'ada',
            displayName: 'Cardano (ADA)',
            shortName: 'ADA',
            network: 'Cardano',
            iconUrl: 'https://nowpayments.io/images/coins/ada.svg',
            methodSlug: 'ada',
        },
    ];

    assert.equal(filterCryptoCurrencies(extended, '').length, extended.length);

    const trc20Matches = filterCryptoCurrencies(extended, 'usdt trc20');
    assert.equal(trc20Matches.length, 1);
    assert.equal(trc20Matches[0].symbol, 'USDT.TRC20');

    const solMatches = filterCryptoCurrencies(extended, 'solana');
    assert.ok(solMatches.some((c) => c.symbol === 'SOL'));
    assert.ok(solMatches.some((c) => c.symbol === 'USDT.SOL'));
    assert.ok(solMatches.some((c) => c.symbol === 'USDC.SOL'));

    const dogeMatches = filterCryptoCurrencies(extended, 'doge');
    assert.equal(dogeMatches.length, 1);
    assert.equal(dogeMatches[0].payCurrency, 'doge');

    const cardanoMatches = filterCryptoCurrencies(extended, 'cardano');
    assert.equal(cardanoMatches.length, 1);
    assert.equal(cardanoMatches[0].symbol, 'ADA');

    assert.equal(filterCryptoCurrencies(extended, 'nonexistent_token_xyz').length, 0);
});

test('payment method icons point to existing case-exact files in public/metodos_icones', () => {
    const publicDir = path.resolve(process.cwd(), 'public');

    assert.equal(
        PAYMENT_METHOD_ICON_PATHS.card,
        '/metodos_icones/logo-visa-mc-color-D7b86M9t.png',
    );
    assert.equal(
        PAYMENT_METHOD_ICON_PATHS.mpesa,
        '/metodos_icones/logo-mpesa-color-9CM38Rpf.png',
    );
    assert.equal(
        PAYMENT_METHOD_ICON_PATHS.emola,
        '/metodos_icones/logo-emola-color-C3UXahgL.png',
    );
    assert.deepEqual(
        PAYFAST_COMPILED_ICONS.map((i) => i.src),
        [
            '/metodos_icones/applepay.png',
            '/metodos_icones/card.PNG',
            '/metodos_icones/EFT.PNG',
            '/metodos_icones/Gpay.jpg',
        ],
    );

    const allPaths = [
        PAYMENT_METHOD_ICON_PATHS.card,
        PAYMENT_METHOD_ICON_PATHS.mpesa,
        PAYMENT_METHOD_ICON_PATHS.emola,
        ...PAYFAST_COMPILED_ICONS.map((i) => i.src),
    ];

    for (const rel of allPaths) {
        const dirName = path.dirname(rel).replace(/^\//, '');
        const fileName = path.basename(rel);
        const dirEntries = fs.readdirSync(path.join(publicDir, dirName));
        assert.ok(
            dirEntries.includes(fileName),
            `Missing exact-case icon file ${rel} in client/public`,
        );
    }
});

test('resolveLocationOption preserves country ISO2, flagUrl, dialCode, and payment methods across countries', () => {
    const mz = resolveLocationOption('MZ');
    assert.equal(mz.code, 'MZ');
    assert.equal(mz.dialCode, '+258');
    assert.equal(mz.flagUrl, 'https://flagcdn.com/mz.svg');
    assert.deepEqual(mz.methods, ['mpesa', 'emola', 'card', 'crypto']);
    assert.equal(mz.defaultMethod, 'mpesa');

    const br = resolveLocationOption('br');
    assert.equal(br.code, 'BR');
    assert.equal(br.dialCode, '+55');
    assert.deepEqual(br.methods, ['pix', 'card', 'crypto']);

    const pt = resolveLocationOption('PT');
    assert.equal(pt.code, 'PT');
    assert.equal(pt.dialCode, '+351');
    assert.equal(pt.flagUrl, 'https://flagcdn.com/pt.svg');
    assert.deepEqual(pt.methods, ['card', 'crypto']);
    assert.equal(pt.defaultMethod, 'card');

    const intl = resolveLocationOption('UNKNOWN');
    assert.equal(intl.code, 'INTL');
    assert.deepEqual(intl.methods, ['card', 'crypto']);
});

test('getPaymentMethodGridClass renders 2 and 3 methods side-by-side on mobile and 2x2/4-col for 4 methods', () => {
    assert.match(getPaymentMethodGridClass(2), /\bgrid-cols-2\b/);
    assert.match(getPaymentMethodGridClass(3), /\bgrid-cols-3\b/);
    assert.match(getPaymentMethodGridClass(4), /\bgrid-cols-2\b.*\bsm:grid-cols-4\b/);
});

test('computeAdaptivePollDelay and parseRetryAfterHeader handle demand backoff and HTTP 429 cleanly', () => {
    assert.equal(
        computeAdaptivePollDelay({ attempt: 0, method: 'mpesa', elapsedMs: 5_000 }),
        3500,
    );
    assert.equal(
        computeAdaptivePollDelay({ attempt: 5, method: 'mpesa', elapsedMs: 60_000 }),
        5500,
    );
    assert.equal(
        computeAdaptivePollDelay({ attempt: 15, method: 'mpesa', elapsedMs: 130_000 }),
        9000,
    );
    assert.equal(
        computeAdaptivePollDelay({ attempt: 2, method: 'crypto', serverNextPollAfterMs: 0 }),
        0,
    );
    assert.equal(
        computeAdaptivePollDelay({
            attempt: 3,
            method: 'card',
            retryAfterMs: 12_000,
            previousDelayMs: 5_000,
        }),
        12_000,
    );
    assert.equal(
        computeAdaptivePollDelay({
            attempt: 4,
            method: 'card',
            retryAfterMs: 25_000,
            previousDelayMs: 20_000,
        }),
        30_000,
    );

    assert.equal(parseRetryAfterHeader({ response: { status: 500 } }), null);
    assert.equal(
        parseRetryAfterHeader({ response: { status: 429, headers: { 'retry-after': '12' } } }),
        12_000,
    );
    assert.equal(parseRetryAfterHeader({ response: { status: 429, headers: {} } }), 10_000);
});

test('detectCallbackFailureFromSearch, buildCheckoutFailureUrl, and resolvePaymentFailureCopy work end-to-end', () => {
    const failed = detectCallbackFailureFromSearch(
        new URLSearchParams('payment_status=failed&payment_reason=cancelled'),
    );
    assert.equal(failed.isFailed, true);
    assert.equal(failed.reason, 'cancelled');

    const ok = detectCallbackFailureFromSearch(new URLSearchParams('payment_status=active'));
    assert.equal(ok.isFailed, false);

    const failureUrl = buildCheckoutFailureUrl({
        localizePath: (p) => `/en${p}`,
        subscriptionId: 'TOREX123',
        method: 'card',
        tier: 'PRO',
        cycle: 'YEARLY',
        reason: 'expired',
    });
    assert.ok(failureUrl.startsWith('/en/checkout?'));
    assert.ok(failureUrl.includes('payment_status=failed'));
    assert.ok(failureUrl.includes('subscription_id=TOREX123'));
    assert.ok(failureUrl.includes('tier=PRO'));

    const ptCopy = resolvePaymentFailureCopy('expired', false);
    assert.equal(ptCopy.title, 'Pagamento Expirado');
    const enCopy = resolvePaymentFailureCopy('failed', true);
    assert.equal(enCopy.title, 'Payment Unsuccessful');
});

test('resolvePricingModalCloseAction logs out inactive users and returns active users to current view', () => {
    assert.equal(
        resolvePricingModalCloseAction({
            isAuthenticated: true,
            hasActivePlan: false,
            hasOnClose: false,
        }),
        'LOGOUT',
    );
    assert.equal(
        resolvePricingModalCloseAction({
            isAuthenticated: true,
            hasActivePlan: false,
            hasOnClose: true,
        }),
        'LOGOUT',
    );
    assert.equal(
        resolvePricingModalCloseAction({
            isAuthenticated: true,
            hasActivePlan: true,
            hasOnClose: true,
        }),
        'CLOSE_TO_CURRENT_VIEW',
    );
    assert.equal(
        resolvePricingModalCloseAction({
            isAuthenticated: false,
            hasActivePlan: false,
            hasOnClose: true,
        }),
        'CLOSE_TO_CURRENT_VIEW',
    );
    assert.equal(
        resolvePricingModalCloseAction({
            isAuthenticated: true,
            hasActivePlan: true,
            hasOnClose: false,
        }),
        'NAVIGATE_FALLBACK',
    );
});
