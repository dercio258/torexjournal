import test from 'node:test';
import assert from 'node:assert/strict';
import { getRegisterErrorMessage } from '../src/lib/authErrors.ts';
import { findCountry, validatePhoneForCountry } from '../src/constants/countries.ts';
import {
    clearPendingVerification,
    PENDING_VERIFICATION_STORAGE_KEY,
    readPendingVerification,
    savePendingVerification,
} from '../src/lib/pendingVerification.ts';

function makeStorageMock() {
    const store = new Map<string, string>();
    return {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => {
            store.set(k, String(v));
        },
        removeItem: (k: string) => {
            store.delete(k);
        },
        clear: () => {
            store.clear();
        },
    };
}

test('pendingVerification persists and recovers across sessionStorage, localStorage, and route state', () => {
    const sessionMock = makeStorageMock();
    const localMock = makeStorageMock();
    (globalThis as any).sessionStorage = sessionMock;
    (globalThis as any).localStorage = localMock;

    try {
        clearPendingVerification();
        assert.equal(readPendingVerification(), null);

        savePendingVerification({
            verificationToken: 'jwt-token-abc',
            emailMasked: 'tr***r@gmail.com',
            returnTo: '/pricing',
            fromLogin: true,
            codeSent: true,
        });

        // Recoverable even if sessionStorage is cleared (e.g. new tab / app reopen)
        sessionMock.removeItem(PENDING_VERIFICATION_STORAGE_KEY);
        const recovered = readPendingVerification();
        assert.equal(recovered?.verificationToken, 'jwt-token-abc');
        assert.equal(recovered?.emailMasked, 'tr***r@gmail.com');
        assert.equal(recovered?.returnTo, '/pricing');
        assert.equal(recovered?.fromLogin, true);

        // Route state takes precedence over storage
        const fromRoute = readPendingVerification({
            pendingVerification: {
                verificationToken: 'fresh-route-token',
                emailMasked: 'ne***w@gmail.com',
            },
        });
        assert.equal(fromRoute?.verificationToken, 'fresh-route-token');

        clearPendingVerification();
        assert.equal(readPendingVerification(), null);
    } finally {
        delete (globalThis as any).sessionStorage;
        delete (globalThis as any).localStorage;
    }
});

test('getRegisterErrorMessage renders verification and cooldown errors cleanly in PT and EN', () => {
    const invalidCodeEn = getRegisterErrorMessage('Código de verificação inválido. Tentativa 1 de 5.', 'en');
    assert.equal(invalidCodeEn.includes('Detalhes:'), false);
    assert.equal(invalidCodeEn.includes('Invalid verification code'), true);

    const invalidCodePt = getRegisterErrorMessage('Código de verificação inválido. Tentativa 1 de 5.', 'pt');
    assert.equal(invalidCodePt, 'Código de verificação inválido. Tentativa 1 de 5.');

    const cooldownEn = getRegisterErrorMessage('Aguarde 60 segundos antes de reenviar o código.', 'en');
    assert.equal(cooldownEn.includes('wait'), true);

    const verifiedEn = getRegisterErrorMessage('Esta conta já foi verificada.', 'en');
    assert.equal(verifiedEn.includes('already verified'), true);
});

test('validatePhoneForCountry enforces backend-aligned digit rules across countries', () => {
    const ng = findCountry('NG') || null;
    assert.equal(validatePhoneForCountry('80123456', ng).valid, false);
    assert.equal(validatePhoneForCountry('8012345678', ng).valid, true);

    const de = findCountry('DE') || null;
    assert.equal(validatePhoneForCountry('1512345', de).valid, false);
    assert.equal(validatePhoneForCountry('1512345678', de).valid, true);

    const mz = findCountry('MZ') || null;
    assert.equal(validatePhoneForCountry('841234567', mz).valid, true);
    assert.equal(validatePhoneForCountry('841234567', mz).e164, '+258841234567');
});
