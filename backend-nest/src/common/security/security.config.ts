import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';

const WEAK_SECRET_PLACEHOLDERS = new Set([
    'dev_secret',
    'default_secret_key',
    'secret',
    'changeme',
    'cossa-trading-deriv-default-secret-key-32b',
]);

let warnedMissingJwtSecret = false;

/**
 * Resolves JWT signing/verification secret consistently across all modules.
 * Fails closed in production if missing or using a known weak placeholder.
 */
export function getJwtSecret(configService?: ConfigService): string {
    const raw = (configService?.get<string>('JWT_SECRET') ?? process.env.JWT_SECRET ?? '').trim();
    const isProd = (configService?.get<string>('NODE_ENV') ?? process.env.NODE_ENV) === 'production';

    if (!raw || WEAK_SECRET_PLACEHOLDERS.has(raw)) {
        if (isProd) {
            throw new Error(
                'CRITICAL SECURITY ERROR: JWT_SECRET não está configurado ou usa um valor padrão inseguro em produção.',
            );
        }
        if (!warnedMissingJwtSecret) {
            warnedMissingJwtSecret = true;
            console.warn(
                '[SecurityConfig] JWT_SECRET ausente em desenvolvimento — usando chave local temporária de dev.',
            );
        }
        return 'torex_dev_only_jwt_secret_do_not_use_in_prod';
    }

    return raw;
}

/**
 * Constant-time string comparison using fixed-length SHA-256 digests so neither
 * character mismatches nor length differences leak timing side-channels.
 */
export function timingSafeEqualStr(a: string | undefined | null, b: string | undefined | null): boolean {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const digestA = createHash('sha256').update(a, 'utf8').digest();
    const digestB = createHash('sha256').update(b, 'utf8').digest();
    return timingSafeEqual(digestA, digestB);
}

/**
 * Resolves allowed CORS origins from FRONTEND_URL, BASE_URL, and CORS_ALLOWED_ORIGINS.
 */
export function resolveAllowedCorsOrigins(configService?: ConfigService): string[] {
    const origins = new Set<string>();

    const candidates = [
        configService?.get<string>('FRONTEND_URL') ?? process.env.FRONTEND_URL,
        configService?.get<string>('BASE_URL') ?? process.env.BASE_URL,
        configService?.get<string>('CORS_ALLOWED_ORIGINS') ?? process.env.CORS_ALLOWED_ORIGINS,
    ];

    for (const raw of candidates) {
        if (!raw) continue;
        for (const entry of raw.split(',')) {
            const trimmed = entry.trim().replace(/\/+$/, '');
            if (!trimmed) continue;
            try {
                const parsed = new URL(trimmed);
                origins.add(parsed.origin);
            } catch {
                // Ignore malformed origin strings
            }
        }
    }

    const isProd = (configService?.get<string>('NODE_ENV') ?? process.env.NODE_ENV) === 'production';
    if (!isProd) {
        origins.add('http://localhost:3000');
        origins.add('http://localhost:3001');
        origins.add('http://localhost:5173');
        origins.add('http://127.0.0.1:3000');
        origins.add('http://127.0.0.1:3001');
        origins.add('http://127.0.0.1:5173');
        origins.add('https://localhost:3000');
        origins.add('https://localhost:3001');
        origins.add('https://localhost:5173');
    }

    return Array.from(origins);
}

/**
 * Evaluates whether an Origin header is authorized for CORS / Socket.IO.
 */
export function isCorsOriginAllowed(origin: string | undefined, configService?: ConfigService): boolean {
    // Non-browser clients (MT5 EA, native apps, server webhooks, same-origin GETs) send no Origin
    if (!origin) return true;

    const normalized = origin.trim().replace(/\/+$/, '');
    const isProd = (configService?.get<string>('NODE_ENV') ?? process.env.NODE_ENV) === 'production';

    if (!isProd && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized)) {
        return true;
    }

    const allowed = resolveAllowedCorsOrigins(configService);
    if (allowed.includes(normalized)) {
        return true;
    }

    // Always allow canonical torexjournal.com (apex + subdomains) over HTTPS.
    // Not gated on NODE_ENV: a missing NODE_ENV=production on the server must
    // not lock the real frontend out of its own API.
    if (/^https:\/\/([a-z0-9-]+\.)?torexjournal\.com$/i.test(normalized)) {
        return true;
    }

    return false;
}

/**
 * Determines whether HTTPS redirection / strict transport enforcement should run.
 */
export function isHttpsEnforced(configService?: ConfigService): boolean {
    const enforceFlag = (configService?.get<string>('ENFORCE_HTTPS') ?? process.env.ENFORCE_HTTPS)?.toLowerCase();
    if (enforceFlag === 'true') return true;
    if (enforceFlag === 'false') return false;

    const allowInsecure = (configService?.get<string>('ALLOW_INSECURE_HTTP') ?? process.env.ALLOW_INSECURE_HTTP)?.toLowerCase();
    if (allowInsecure === 'true') return false;

    const isProd = (configService?.get<string>('NODE_ENV') ?? process.env.NODE_ENV) === 'production';
    if (!isProd) return false;

    const baseUrl = (configService?.get<string>('BASE_URL') ?? process.env.BASE_URL ?? '').trim();
    const frontendUrl = (configService?.get<string>('FRONTEND_URL') ?? process.env.FRONTEND_URL ?? '').trim();
    return baseUrl.startsWith('https://') || frontendUrl.startsWith('https://');
}

/**
 * Extracts client IP relying on Fastify's trusted-proxy aware `req.ip` rather than
 * blindly concatenating spoofable headers like raw `X-Forwarded-For` + `User-Agent`.
 */
export function extractTrustedClientIp(req: any): string {
    const rawIp =
        req?.ip ||
        req?.socket?.remoteAddress ||
        req?.raw?.socket?.remoteAddress ||
        'unknown_ip';
    return String(rawIp).replace(/^::ffff:/, '').trim() || 'unknown_ip';
}

/**
 * Resolves Fastify `trustProxy` setting safely.
 * Set `TRUST_PROXY` env to `'false'`, `'true'`, a hop count (e.g. `'1'`), or CIDR/IP list.
 * Defaults to `1` hop in production (standard CDN/reverse proxy) and `1` locally.
 */
export function getTrustProxySetting(): boolean | number | string {
    const raw = process.env.TRUST_PROXY?.trim();
    if (!raw) return 1;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    const hops = Number(raw);
    if (Number.isInteger(hops) && hops >= 0) return hops;
    return raw;
}

/**
 * Checks whether an incoming request used HTTPS (natively or via trusted reverse proxy).
 */
export function isRequestHttps(req: any): boolean {
    if (req?.protocol === 'https' || req?.raw?.socket?.encrypted) return true;
    const xfProto = String(req?.headers?.['x-forwarded-proto'] || '')
        .split(',')[0]
        .trim()
        .toLowerCase();
    return xfProto === 'https';
}

/**
 * Checks if request targets a loopback interface (used to allow local healthchecks/workers).
 */
export function isLoopbackRequest(req: any): boolean {
    const ip = extractTrustedClientIp(req);
    const host = String(req?.headers?.host || '').split(':')[0].toLowerCase();
    return (
        ip === '127.0.0.1' ||
        ip === '::1' ||
        host === 'localhost' ||
        host === '127.0.0.1'
    );
}
