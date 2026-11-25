import { FastifyReply } from 'fastify';
import { isHttpsEnforced, isRequestHttps } from './security.config';

export const USER_ACCESS_COOKIE_HTTPS = '__Host-torex_at';
export const USER_ACCESS_COOKIE_HTTP = 'torex_at';
export const USER_REFRESH_COOKIE_HTTPS = '__Host-torex_rt';
export const USER_REFRESH_COOKIE_HTTP = 'torex_rt';
export const ADMIN_SESSION_COOKIE_HTTPS = '__Host-torex_admin';
export const ADMIN_SESSION_COOKIE_HTTP = 'torex_admin';

export function parseCookies(cookieHeader?: string | string[]): Record<string, string> {
    const out: Record<string, string> = Object.create(null);
    const raw = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader;
    if (!raw || typeof raw !== 'string') return out;

    for (const part of raw.split(';')) {
        const idx = part.indexOf('=');
        if (idx <= 0) continue;
        const key = part.slice(0, idx).trim();
        if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') {
            continue;
        }
        const val = part.slice(idx + 1).trim();
        try {
            out[key] = decodeURIComponent(val);
        } catch {
            out[key] = val;
        }
    }
    return out;
}

export function extractBearerToken(authHeader?: string | string[]): string | null {
    const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (!raw || typeof raw !== 'string') return null;
    if (!raw.toLowerCase().startsWith('bearer ')) return null;
    const token = raw.slice(7).trim();
    return token || null;
}

export function extractUserAccessToken(req: any): string | null {
    const fromHeader = extractBearerToken(req?.headers?.authorization);
    if (fromHeader) return fromHeader;
    const cookies = parseCookies(req?.headers?.cookie);
    return cookies[USER_ACCESS_COOKIE_HTTPS] || cookies[USER_ACCESS_COOKIE_HTTP] || null;
}

export function extractUserRefreshToken(req: any, bodyToken?: string): string | null {
    if (typeof bodyToken === 'string' && bodyToken.trim()) {
        return bodyToken.trim();
    }
    const cookies = parseCookies(req?.headers?.cookie);
    return cookies[USER_REFRESH_COOKIE_HTTPS] || cookies[USER_REFRESH_COOKIE_HTTP] || null;
}

export function extractAdminToken(req: any): string | null {
    const fromHeader = extractBearerToken(req?.headers?.authorization);
    if (fromHeader) return fromHeader;
    const cookies = parseCookies(req?.headers?.cookie);
    return cookies[ADMIN_SESSION_COOKIE_HTTPS] || cookies[ADMIN_SESSION_COOKIE_HTTP] || null;
}

export function extractSocketTokenFromHandshake(handshake: any): string | null {
    const authToken = handshake?.auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) {
        return authToken.replace(/^Bearer\s+/i, '').trim();
    }
    const fromHeader = extractBearerToken(handshake?.headers?.authorization);
    if (fromHeader) return fromHeader;
    const cookies = parseCookies(handshake?.headers?.cookie);
    return cookies[USER_ACCESS_COOKIE_HTTPS] || cookies[USER_ACCESS_COOKIE_HTTP] || null;
}

export function isCookieAuthenticatedMutation(req: any): boolean {
    const method = String(req?.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
        return false;
    }
    if (extractBearerToken(req?.headers?.authorization)) {
        return false;
    }
    const cookies = parseCookies(req?.headers?.cookie);
    return Boolean(
        cookies[USER_ACCESS_COOKIE_HTTPS] ||
            cookies[USER_ACCESS_COOKIE_HTTP] ||
            cookies[USER_REFRESH_COOKIE_HTTPS] ||
            cookies[USER_REFRESH_COOKIE_HTTP] ||
            cookies[ADMIN_SESSION_COOKIE_HTTPS] ||
            cookies[ADMIN_SESSION_COOKIE_HTTP],
    );
}

function appendSetCookie(reply: FastifyReply, cookieStr: string): void {
    const existing = reply.getHeader('set-cookie');
    if (!existing) {
        reply.header('Set-Cookie', [cookieStr]);
    } else if (Array.isArray(existing)) {
        reply.header('Set-Cookie', [...existing.map(String), cookieStr]);
    } else {
        reply.header('Set-Cookie', [String(existing), cookieStr]);
    }
}

function serializeCookie(
    name: string,
    value: string,
    opts: {
        httpOnly?: boolean;
        secure?: boolean;
        sameSite?: 'Lax' | 'Strict' | 'None';
        path?: string;
        maxAgeSeconds?: number;
    },
): string {
    const parts = [`${name}=${encodeURIComponent(value)}`];
    parts.push(`Path=${opts.path || '/'}`);
    if (opts.maxAgeSeconds !== undefined) {
        parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAgeSeconds))}`);
    }
    if (opts.httpOnly !== false) parts.push('HttpOnly');
    if (opts.secure) parts.push('Secure');
    if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
    return parts.join('; ');
}

function shouldUseSecureCookies(req: any): boolean {
    return isRequestHttps(req) || isHttpsEnforced();
}

export function setUserSessionCookies(
    reply: FastifyReply,
    req: any,
    tokens: { accessToken?: string | null; refreshToken?: string | null },
): void {
    if (!reply || typeof reply.header !== 'function') return;
    const secure = shouldUseSecureCookies(req);

    if (tokens.accessToken) {
        const name = secure ? USER_ACCESS_COOKIE_HTTPS : USER_ACCESS_COOKIE_HTTP;
        appendSetCookie(
            reply,
            serializeCookie(name, tokens.accessToken, {
                httpOnly: true,
                secure,
                sameSite: 'Lax',
                path: '/',
                maxAgeSeconds: 24 * 60 * 60,
            }),
        );
    }

    if (tokens.refreshToken) {
        // __Host- cookies MUST have Path=/ per RFC 6265bis; SameSite=Strict protects refresh endpoint
        const name = secure ? USER_REFRESH_COOKIE_HTTPS : USER_REFRESH_COOKIE_HTTP;
        appendSetCookie(
            reply,
            serializeCookie(name, tokens.refreshToken, {
                httpOnly: true,
                secure,
                sameSite: 'Strict',
                path: '/',
                maxAgeSeconds: 30 * 24 * 60 * 60,
            }),
        );
    }
}

export function clearUserSessionCookies(reply: FastifyReply, req: any): void {
    if (!reply || typeof reply.header !== 'function') return;
    const secure = shouldUseSecureCookies(req);
    for (const name of [
        USER_ACCESS_COOKIE_HTTPS,
        USER_ACCESS_COOKIE_HTTP,
        USER_REFRESH_COOKIE_HTTPS,
        USER_REFRESH_COOKIE_HTTP,
    ]) {
        const isHostPrefixed = name.startsWith('__Host-');
        if (isHostPrefixed && !secure) continue;
        appendSetCookie(
            reply,
            serializeCookie(name, '', {
                httpOnly: true,
                secure: isHostPrefixed || secure,
                sameSite: name.includes('_rt') ? 'Strict' : 'Lax',
                path: '/',
                maxAgeSeconds: 0,
            }),
        );
    }
}

export function setAdminSessionCookie(
    reply: FastifyReply,
    req: any,
    adminToken: string,
): void {
    if (!reply || typeof reply.header !== 'function' || !adminToken) return;
    const secure = shouldUseSecureCookies(req);
    const name = secure ? ADMIN_SESSION_COOKIE_HTTPS : ADMIN_SESSION_COOKIE_HTTP;
    appendSetCookie(
        reply,
        serializeCookie(name, adminToken, {
            httpOnly: true,
            secure,
            sameSite: 'Strict',
            path: '/',
            maxAgeSeconds: 12 * 60 * 60,
        }),
    );
}

export function clearAdminSessionCookie(reply: FastifyReply, req: any): void {
    if (!reply || typeof reply.header !== 'function') return;
    const secure = shouldUseSecureCookies(req);
    for (const name of [ADMIN_SESSION_COOKIE_HTTPS, ADMIN_SESSION_COOKIE_HTTP]) {
        const isHostPrefixed = name.startsWith('__Host-');
        if (isHostPrefixed && !secure) continue;
        appendSetCookie(
            reply,
            serializeCookie(name, '', {
                httpOnly: true,
                secure: isHostPrefixed || secure,
                sameSite: 'Strict',
                path: '/',
                maxAgeSeconds: 0,
            }),
        );
    }
}
