import test from 'node:test';
import assert from 'node:assert/strict';
import { isAdminApiUrl, isValidAdminToken } from '../src/lib/adminAuth.ts';
import { escapeHtml, sanitizeRichHtml } from '../src/utils/sanitizeHtml.ts';
import { escapeCsvCell } from '../src/utils/documentExporter.ts';
import { parseClientEmbedPreview } from '../src/components/network/networkTypes.ts';
import {
    findCountry,
    inferCountryFromTimezone,
    validatePhoneForCountry,
} from '../src/constants/countries.ts';

function toBase64Url(str: string): string {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeUnsignedJwt(payload: Record<string, unknown>): string {
    const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = toBase64Url(JSON.stringify(payload));
    return `${header}.${body}.fakesignature`;
}

test('isAdminApiUrl strictly distinguishes admin endpoints from user endpoints', () => {
    assert.equal(isAdminApiUrl('/admin/telemetry'), true);
    assert.equal(isAdminApiUrl('/api/admin/users?page=1'), true);
    assert.equal(isAdminApiUrl('https://torex.app/api/admin/lessons'), true);
    assert.equal(isAdminApiUrl('/dashboard/trades'), false);
    assert.equal(isAdminApiUrl('/accounts'), false);
    assert.equal(isAdminApiUrl('/user/admin-notes'), false);
    assert.equal(isAdminApiUrl(''), false);
});

test('isValidAdminToken requires non-expired JWT with role=admin and isAdmin=true', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const pastExp = Math.floor(Date.now() / 1000) - 60;

    const validAdmin = makeUnsignedJwt({ email: 'a@torex.com', role: 'admin', isAdmin: true, exp: futureExp });
    const regularUser = makeUnsignedJwt({ sub: 'user-1', role: 'user', exp: futureExp });
    const fakeRole = makeUnsignedJwt({ role: 'ADMIN', isAdmin: false, exp: futureExp });
    const expiredAdmin = makeUnsignedJwt({ role: 'admin', isAdmin: true, exp: pastExp });

    assert.equal(isValidAdminToken(validAdmin), true);
    assert.equal(isValidAdminToken(regularUser), false);
    assert.equal(isValidAdminToken(fakeRole), false);
    assert.equal(isValidAdminToken(expiredAdmin), false);
    assert.equal(isValidAdminToken('not-a-jwt'), false);
    assert.equal(isValidAdminToken(null), false);
});

test('sanitizeRichHtml and escapeHtml neutralise XSS vectors while keeping safe journal markup', () => {
    const dirty =
        '<p>Setup <strong>A+</strong></p>' +
        '<script>alert("xss")</script>' +
        '<svg onload="alert(1)"><circle /></svg>' +
        '<iframe src="https://evil.test/frame"></iframe>' +
        '<img src="https://cdn.example.com/chart.png" onerror="alert(1)" />' +
        '<img src="javascript:alert(1)" />' +
        '<a href="javascript:alert(1)">bad</a>' +
        '<a href="https://tradingview.com/chart" target="_blank">chart</a>';

    const clean = sanitizeRichHtml(dirty);
    assert.equal(/<script/i.test(clean), false);
    assert.equal(/<svg/i.test(clean), false);
    assert.equal(/<iframe/i.test(clean), false);
    assert.equal(/onerror/i.test(clean), false);
    assert.equal(/onload/i.test(clean), false);
    assert.equal(/javascript:/i.test(clean), false);
    assert.equal(clean.includes('<strong>A+</strong>'), true);
    assert.equal(clean.includes('https://cdn.example.com/chart.png'), true);
    assert.equal(clean.includes('rel="noopener noreferrer"'), true);

    assert.equal(
        escapeHtml(`<script>"a" & 'b'</script>`),
        '&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;',
    );
});

test('escapeCsvCell neutralizes spreadsheet formula prefixes without corrupting negative numbers', () => {
    assert.equal(escapeCsvCell('=SUM(A1:A2)'), "'=SUM(A1:A2)");
    assert.equal(escapeCsvCell('+cmd|"/C calc"!A0'), '"\'+cmd|""/C calc""!A0"');
    assert.equal(escapeCsvCell('@SUM(1)'), "'@SUM(1)");
    assert.equal(escapeCsvCell('-cmd'), "'-cmd");
    assert.equal(escapeCsvCell('\t=1+1'), "'\t=1+1");
    assert.equal(escapeCsvCell('\r=1+1'), '"\'\r=1+1"');
    assert.equal(escapeCsvCell(-12.5), '-12.5');
    assert.equal(escapeCsvCell('-100'), '-100');
});

test('parseClientEmbedPreview enforces HTTPS embed domain allowlist', () => {
    const yt = parseClientEmbedPreview('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.equal(yt.embedType, 'iframe');
    assert.equal(yt.embedUrl, 'https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1');

    const panda = parseClientEmbedPreview('https://player-vz-123.tv.pandavideo.com.br/embed/?v=abc');
    assert.equal(panda.embedType, 'iframe');
    assert.equal(panda.embedUrl, 'https://player-vz-123.tv.pandavideo.com.br/embed/?v=abc');

    const evilHttps = parseClientEmbedPreview('https://evil.example/embed/video');
    assert.equal(evilHttps.embedUrl, null);

    const insecureHttp = parseClientEmbedPreview('http://pandavideo.com.br/embed/?v=abc');
    assert.equal(insecureHttp.embedUrl, null);
});

test('inferCountryFromTimezone and validatePhoneForCountry enforce explicit dial prefixes', () => {
    const mz = inferCountryFromTimezone('Africa/Maputo');
    assert.equal(mz?.iso2, 'MZ');
    assert.equal(mz?.dialCode, '+258');

    const pt = inferCountryFromTimezone('Europe/Lisbon');
    assert.equal(pt?.iso2, 'PT');
    assert.equal(pt?.dialCode, '+351');

    // Missing country selection must fail validation (non-consented manual mode)
    const noCountry = validatePhoneForCountry('841234567', null);
    assert.equal(noCountry.valid, false);

    // Valid Mozambique number with MZ dial prefix
    const validMz = validatePhoneForCountry('841234567', findCountry('MZ') || null);
    assert.equal(validMz.valid, true);
    assert.equal(validMz.e164, '+258841234567');

    // Too short for Portugal (+351 expects 9 local digits)
    const shortPt = validatePhoneForCountry('91234', findCountry('PT') || null);
    assert.equal(shortPt.valid, false);
});
