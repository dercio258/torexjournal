import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'crypto';

const WEAK_SECRET_PLACEHOLDERS = new Set([
    'dev_secret',
    'default_secret_key',
    'secret',
    'changeme',
    'secret_worker_key_change_me',
    'cossa-trading-deriv-default-secret-key-32b',
    'CHANGE_ME',
    'CHANGE_ME_MIN_32_CHARS',
]);

let warnedMissingJwtSecret = false;
let warnedMissingAdminJwtSecret = false;

function readEnv(configService: ConfigService | undefined, key: string): string {
    return (configService?.get<string>(key) ?? process.env[key] ?? '').trim();
}

function isProdEnv(configService?: ConfigService): boolean {
    return (readEnv(configService, 'NODE_ENV') || 'development') === 'production';
}

function deriveDomainSecret(domain: string, baseSecret: string): string {
    return createHmac('sha256', baseSecret).update(`torex-domain:${domain}`).digest('hex');
}

/**
 * Resolves regular user JWT signing/verification secret consistently across user modules.
 * Supports USER_JWT_SECRET (preferred) or JWT_SECRET. Fails closed in production.
 */
export function getJwtSecret(configService?: ConfigService): string {
    const raw = readEnv(configService, 'USER_JWT_SECRET') || readEnv(configService, 'JWT_SECRET');
    const isProd = isProdEnv(configService);

    if (!raw || WEAK_SECRET_PLACEHOLDERS.has(raw)) {
        if (isProd) {
            throw new Error(
                'CRITICAL SECURITY ERROR: JWT_SECRET (ou USER_JWT_SECRET) não está configurado ou usa um valor padrão inseguro em produção.',
            );
        }
        if (!warnedMissingJwtSecret) {
            warnedMissingJwtSecret = true;
            console.warn(
                '[SecurityConfig] JWT_SECRET/USER_JWT_SECRET ausente em desenvolvimento — usando chave local temporária de dev.',
            );
        }
        return 'torex_dev_only_jwt_secret_do_not_use_in_prod';
    }

    return raw;
}

export const getUserJwtSecret = getJwtSecret;

/**
 * Resolves dedicated Backoffice Admin JWT secret (ADMIN_JWT_SECRET).
 * Strictly isolated from regular user JWTs; required and distinct in production.
 */
export function getAdminJwtSecret(configService?: ConfigService): string {
    const userSecret = getJwtSecret(configService);
    const raw = readEnv(configService, 'ADMIN_JWT_SECRET');
    const isProd = isProdEnv(configService);

    if (!raw || WEAK_SECRET_PLACEHOLDERS.has(raw)) {
        if (isProd) {
            throw new Error(
                'CRITICAL SECURITY ERROR: ADMIN_JWT_SECRET é obrigatório e deve ser forte em produção.',
            );
        }
        if (!warnedMissingAdminJwtSecret) {
            warnedMissingAdminJwtSecret = true;
            console.warn(
                '[SecurityConfig] ADMIN_JWT_SECRET ausente em dev — derivando segredo isolado de admin.',
            );
        }
        return deriveDomainSecret('admin-jwt', userSecret);
    }

    if (timingSafeEqualStr(raw, userSecret)) {
        if (isProd) {
            throw new Error(
                'CRITICAL SECURITY ERROR: ADMIN_JWT_SECRET deve ser diferente de JWT_SECRET/USER_JWT_SECRET.',
            );
        }
        return deriveDomainSecret('admin-jwt', `${raw}:dev-isolated`);
    }

    return raw;
}

function getDomainSecret(
    configService: ConfigService | undefined,
    envKeys: string[],
    domainTag: string,
): string {
    for (const key of envKeys) {
        const val = readEnv(configService, key);
        if (val && !WEAK_SECRET_PLACEHOLDERS.has(val)) {
            return val;
        }
    }
    return deriveDomainSecret(domainTag, getJwtSecret(configService));
}

export function getTwoFactorJwtSecret(configService?: ConfigService): string {
    return getDomainSecret(configService, ['TWO_FACTOR_JWT_SECRET'], 'two-factor-jwt');
}

export function getPasswordResetSecret(configService?: ConfigService): string {
    return getDomainSecret(configService, ['PASSWORD_RESET_SECRET'], 'password-reset');
}

export function getOAuthStateSecret(configService?: ConfigService): string {
    return getDomainSecret(configService, ['OAUTH_STATE_SECRET'], 'oauth-state');
}

export function getAnalyticsHmacSecret(configService?: ConfigService): string {
    return getDomainSecret(configService, ['ANALYTICS_HMAC_SECRET'], 'analytics-hmac');
}

export function getMt5CredentialSecret(configService?: ConfigService): string {
    return getDomainSecret(
        configService,
        ['MT5_CREDENTIAL_SECRET', 'WORKER_KEY', 'MT5_WORKER_KEY'],
        'mt5-credential',
    );
}

export function getDerivEncryptionSecret(configService?: ConfigService): string {
    const raw = readEnv(configService, 'DERIV_ENCRYPTION_KEY');
    if (raw && !WEAK_SECRET_PLACEHOLDERS.has(raw)) {
        return raw;
    }
    return deriveDomainSecret('deriv-encryption', getJwtSecret(configService));
}

export function getAiQuorumHmacSalt(configService?: ConfigService): string {
    return getDomainSecret(configService, ['AI_QUORUM_HMAC_SALT'], 'ai-quorum-salt');
}

/**
 * Boot-time check for segregated domain secrets.
 */
export function validateDomainSecretsOnBoot(configService?: ConfigService): void {
    getJwtSecret(configService);
    getAdminJwtSecret(configService);
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

export function getQuantInternalHeaders(
    extra: Record<string, string> = {},
): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    const key = process.env.QUANT_INTERNAL_KEY?.trim();
    if (key) {
        headers['X-Internal-Key'] = key;
    }
    return headers;
}

/**
 * Checks if request targets a loopback interface (used to allow local healthchecks/workers).
 */
export function isLoopbackRequest(req: any): boolean {
    const ip = extractTrustedClientIp(req);
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
