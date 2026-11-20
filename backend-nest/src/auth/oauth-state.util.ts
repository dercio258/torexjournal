import { createHmac, randomBytes } from 'crypto';
import { timingSafeEqualStr } from '../common/security/security.config';

export const OAUTH_STATE_COOKIE_NAME = 'torex_oauth_state';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export function generateOAuthState(
    secret: string,
    isHttps: boolean = false,
): { state: string; setCookieHeader: string } {
    const nonce = randomBytes(16).toString('hex');
    const ts = Date.now().toString();
    const payload = `${nonce}.${ts}`;
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    const state = `${payload}.${sig}`;

    const secureFlag = isHttps ? '; Secure' : '';
    const setCookieHeader = `${OAUTH_STATE_COOKIE_NAME}=${state}; HttpOnly; Path=/api/auth; Max-Age=600; SameSite=Lax${secureFlag}`;

    return { state, setCookieHeader };
}

export function buildClearOAuthStateCookieHeader(isHttps: boolean = false): string {
    const secureFlag = isHttps ? '; Secure' : '';
    return `${OAUTH_STATE_COOKIE_NAME}=; HttpOnly; Path=/api/auth; Max-Age=0; SameSite=Lax${secureFlag}`;
}

export function extractCookieValue(
    cookieHeader: string | undefined,
    cookieName: string,
): string | undefined {
    if (!cookieHeader || typeof cookieHeader !== 'string') return undefined;
    const pairs = cookieHeader.split(';');
    for (const pair of pairs) {
        const idx = pair.indexOf('=');
        if (idx === -1) continue;
        const name = pair.slice(0, idx).trim();
        if (name === cookieName) {
            return pair.slice(idx + 1).trim();
        }
    }
    return undefined;
}

export function verifyOAuthState(
    state: string | undefined,
    cookieHeader: string | undefined,
    secret: string,
    nowMs: number = Date.now(),
): boolean {
    if (!state || typeof state !== 'string' || !secret) return false;
    const parts = state.trim().split('.');
    if (parts.length !== 3) return false;

    const [nonce, tsRaw, sig] = parts;
    if (!/^[a-f0-9]{32}$/i.test(nonce)) return false;
    if (!/^\d{10,16}$/.test(tsRaw)) return false;
    if (!/^[a-f0-9]{64}$/i.test(sig)) return false;

    const ts = Number(tsRaw);
    if (!Number.isFinite(ts)) return false;
    if (nowMs - ts > OAUTH_STATE_TTL_MS || ts > nowMs + 60_000) {
        return false;
    }

    const expectedSig = createHmac('sha256', secret)
        .update(`${nonce}.${tsRaw}`)
        .digest('hex');
    if (!timingSafeEqualStr(expectedSig, sig)) {
        return false;
    }

    const cookieState = extractCookieValue(cookieHeader, OAUTH_STATE_COOKIE_NAME);
    if (cookieState !== undefined) {
        return timingSafeEqualStr(cookieState, state.trim());
    }

    return true;
}
