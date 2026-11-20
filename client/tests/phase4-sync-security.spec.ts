import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, sanitizeRichHtml } from '../src/utils/sanitizeHtml.ts';
import { getReplayVaultStorageKey } from '../src/services/backtestSessionSnapshot.ts';

test('sanitizeRichHtml removes script, event handlers, and javascript: URIs in Node fallback', () => {
    const dirty =
        '<h2>Resumo</h2>' +
        '<script>fetch("https://evil.test")</script>' +
        '<img src="x" onerror="alert(1)" />' +
        '<a href="javascript:alert(2)" target="_blank">Click</a>' +
        '<p><strong>Aprovado</strong> com risco 1%</p>';

    const clean = sanitizeRichHtml(dirty);
    assert.equal(clean.includes('<script'), false);
    assert.equal(clean.includes('onerror'), false);
    assert.equal(clean.toLowerCase().includes('javascript:'), false);
    assert.equal(clean.includes('<strong>Aprovado</strong>'), true);
});

test('escapeHtml neutralises HTML special characters for exported KPIs', () => {
    const raw = `<img src=x onerror="alert('xss')">&`;
    const escaped = escapeHtml(raw);
    assert.equal(escaped.includes('<'), false);
    assert.equal(escaped.includes('>'), false);
    assert.equal(escaped.includes('"'), false);
    assert.equal(escaped.includes('&lt;img'), true);
});

test('getReplayVaultStorageKey isolates backtest snapshots per authenticated user scope', () => {
    const originalStorage = (globalThis as any).localStorage;
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => store.set(k, String(v)),
        removeItem: (k: string) => store.delete(k),
    };

    try {
        store.set('torex_last_user_scope', 'user-alpha-111');
        const keyA = getReplayVaultStorageKey('session-99');

        store.set('torex_last_user_scope', 'user-beta-222');
        const keyB = getReplayVaultStorageKey('session-99');

        assert.notEqual(keyA, keyB);
        assert.equal(keyA.includes('user-alpha-111'), true);
        assert.equal(keyB.includes('user-beta-222'), true);

        store.delete('torex_last_user_scope');
        const anonKey = getReplayVaultStorageKey('session-99');
        assert.equal(anonKey.includes('_anon_session-99'), true);
    } finally {
        if (originalStorage === undefined) {
            delete (globalThis as any).localStorage;
        } else {
            (globalThis as any).localStorage = originalStorage;
        }
    }
});
