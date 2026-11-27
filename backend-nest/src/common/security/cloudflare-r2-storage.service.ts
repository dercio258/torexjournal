import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getJwtSecret } from './security.config';

export interface R2StorageConfig {
    enabled: boolean;
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    endpoint: string;
    publicBucket: string;
    privateBucket: string;
    publicBaseUrl: string;
    presignTtlSeconds: number;
}

export interface StoredObjectResult {
    url: string;
    key: string;
    provider: 'cloudflare-r2' | 'local-signed';
    visibility: 'public' | 'private';
    contentType: string;
    sizeBytes: number;
    sha256: string;
}

export interface SignedUrlResult {
    url: string;
    key: string;
    expiresAt: string;
    ttlSeconds: number;
    provider: 'cloudflare-r2' | 'local-signed';
    signatureAlg: 'AWS4-HMAC-SHA256' | 'HMAC-SHA256';
}

const MIME_BY_EXT: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    ogg: 'video/ogg',
    mov: 'video/quicktime',
    pdf: 'application/pdf',
    csv: 'text/csv; charset=utf-8',
    json: 'application/json; charset=utf-8',
};

function rfc3986Encode(str: string): string {
    return encodeURIComponent(str).replace(
        /[!'()*]/g,
        (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}

function encodeObjectKeyPath(key: string): string {
    return key
        .split('/')
        .filter((seg) => seg.length > 0)
        .map((seg) => rfc3986Encode(seg))
        .join('/');
}

function sha256Hex(data: Buffer | string): string {
    return createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
    return createHmac('sha256', key).update(data, 'utf8').digest();
}

function formatAmzDates(date = new Date()): { amzDate: string; dateStamp: string } {
    const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    return {
        amzDate: iso, // YYYYMMDDTHHMMSSZ
        dateStamp: iso.slice(0, 8), // YYYYMMDD
    };
}

function deriveSigningKey(
    secretAccessKey: string,
    dateStamp: string,
    region = 'auto',
    service = 's3',
): Buffer {
    const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
    const kRegion = hmacSha256(kDate, region);
    const kService = hmacSha256(kRegion, service);
    return hmacSha256(kService, 'aws4_request');
}

export function normalizeSafeExtension(rawExt?: string, fallback = 'png'): string {
    const clean = String(rawExt || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    if (!clean) return fallback;
    if (clean === 'jpeg') return 'jpg';
    if (clean in MIME_BY_EXT) return clean;
    return fallback;
}

export function resolveMimeForExtension(ext: string): string {
    return MIME_BY_EXT[ext.toLowerCase()] || 'application/octet-stream';
}

/**
 * Zero-dependency S3-compatible Cloudflare R2 storage service using AWS Signature Version 4 (SigV4)
 * + seamless local-disk fallback with expiring HMAC-SHA256 signed URLs when R2 credentials are not set.
 */
@Injectable()
export class CloudflareR2StorageService {
    private readonly logger = new Logger(CloudflareR2StorageService.name);

    constructor(private readonly configService: ConfigService) {}

    private readEnv(key: string): string {
        return (this.configService?.get<string>(key) ?? process.env[key] ?? '').trim();
    }

    getConfig(): R2StorageConfig {
        const accountId = this.readEnv('R2_ACCOUNT_ID');
        const accessKeyId = this.readEnv('R2_ACCESS_KEY_ID');
        const secretAccessKey = this.readEnv('R2_SECRET_ACCESS_KEY');
        const jurisdiction = this.readEnv('R2_JURISDICTION').toLowerCase();
        const customEndpoint = this.readEnv('R2_ENDPOINT').replace(/\/+$/, '');
        const defaultEndpoint = accountId
            ? jurisdiction && jurisdiction !== 'default'
                ? `https://${accountId}.${jurisdiction}.r2.cloudflarestorage.com`
                : `https://${accountId}.r2.cloudflarestorage.com`
            : '';

        const endpoint = customEndpoint || defaultEndpoint;
        const publicBucket = this.readEnv('R2_PUBLIC_BUCKET') || 'torex-public';
        const privateBucket = this.readEnv('R2_PRIVATE_BUCKET') || 'torex-private';
        const publicBaseUrl = this.readEnv('R2_PUBLIC_URL').replace(/\/+$/, '');
        const rawTtl = Number(this.readEnv('R2_PRESIGN_TTL_SECONDS') || '300');
        const presignTtlSeconds = Number.isFinite(rawTtl)
            ? Math.min(3600, Math.max(60, Math.floor(rawTtl)))
            : 300;

        const enabled = Boolean(endpoint && accessKeyId && secretAccessKey);

        return {
            enabled,
            accountId,
            accessKeyId,
            secretAccessKey,
            endpoint,
            publicBucket,
            privateBucket,
            publicBaseUrl,
            presignTtlSeconds,
        };
    }

    isR2Enabled(): boolean {
        return this.getConfig().enabled;
    }

    getStatus() {
        const cfg = this.getConfig();
        return {
            provider: cfg.enabled ? ('cloudflare-r2' as const) : ('local-signed' as const),
            r2Enabled: cfg.enabled,
            publicBucket: cfg.publicBucket,
            privateBucket: cfg.privateBucket,
            publicUrlConfigured: Boolean(cfg.publicBaseUrl),
            presignTtlSeconds: cfg.presignTtlSeconds,
        };
    }

    private getMediaSigningSecret(): string {
        const dedicated = this.readEnv('MEDIA_SIGNING_SECRET');
        if (dedicated) return dedicated;
        return createHmac('sha256', getJwtSecret(this.configService))
            .update('torex-media-signing-v1')
            .digest('hex');
    }

    /**
     * Derives an irreversible owner partition tag so private object keys never leak raw user UUIDs.
     */
    computeOwnerTag(userId: string): string {
        return createHmac('sha256', this.getMediaSigningSecret())
            .update(`owner:${String(userId || '').trim()}`)
            .digest('hex')
            .slice(0, 24);
    }

    /**
     * Validates that a private object key has safe structure and belongs to `userId`.
     */
    isPrivateKeyOwnedByUser(key: string, userId: string): boolean {
        const cleanKey = this.sanitizeObjectKey(key);
        if (!cleanKey) return false;
        const expectedPrefix = `private/${this.computeOwnerTag(userId)}/`;
        return cleanKey.startsWith(expectedPrefix);
    }

    sanitizeObjectKey(rawKey: string): string | null {
        const clean = String(rawKey || '')
            .trim()
            .replace(/^\/+/, '');
        if (!clean || clean.length > 512) return null;
        if (clean.includes('..') || clean.includes('\\') || /[\r\n\0\s]/.test(clean)) {
            return null;
        }
        if (!/^[a-zA-Z0-9._/-]+$/.test(clean)) return null;
        return clean;
    }

    /**
     * Builds AWS SigV4 signed headers for Cloudflare R2 S3 API operations.
     */
    buildSigV4Headers(params: {
        method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
        bucket: string;
        key: string;
        body?: Buffer;
        contentType?: string;
        cacheControl?: string;
        now?: Date;
    }): { url: string; headers: Record<string, string> } {
        const cfg = this.getConfig();
        if (!cfg.enabled) {
            throw new Error('Cloudflare R2 is not configured');
        }

        const encodedKey = encodeObjectKeyPath(params.key);
        const canonicalUri = encodedKey
            ? `/${rfc3986Encode(params.bucket)}/${encodedKey}`
            : `/${rfc3986Encode(params.bucket)}`;
        const endpointUrl = new URL(cfg.endpoint);
        const host = endpointUrl.host;
        const fullUrl = `${cfg.endpoint}${canonicalUri}`;
        const { amzDate, dateStamp } = formatAmzDates(params.now);
        const payloadHash = sha256Hex(params.body || Buffer.alloc(0));

        const headerMap: Record<string, string> = {
            host,
            'x-amz-content-sha256': payloadHash,
            'x-amz-date': amzDate,
        };
        if (params.contentType) {
            headerMap['content-type'] = params.contentType;
        }
        if (params.cacheControl) {
            headerMap['cache-control'] = params.cacheControl;
        }

        const sortedKeys = Object.keys(headerMap).sort();
        const canonicalHeaders = sortedKeys.map((k) => `${k}:${headerMap[k].trim()}\n`).join('');
        const signedHeaders = sortedKeys.join(';');

        const canonicalRequest = [
            params.method,
            canonicalUri,
            '', // canonical query string
            canonicalHeaders,
            signedHeaders,
            payloadHash,
        ].join('\n');

        const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
        const stringToSign = [
            'AWS4-HMAC-SHA256',
            amzDate,
            credentialScope,
            sha256Hex(canonicalRequest),
        ].join('\n');

        const signingKey = deriveSigningKey(cfg.secretAccessKey, dateStamp, 'auto', 's3');
        const signature = createHmac('sha256', signingKey)
            .update(stringToSign, 'utf8')
            .digest('hex');

        const authorization =
            `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, ` +
            `SignedHeaders=${signedHeaders}, Signature=${signature}`;

        const outHeaders: Record<string, string> = {
            Authorization: authorization,
            'x-amz-date': amzDate,
            'x-amz-content-sha256': payloadHash,
        };
        if (params.contentType) outHeaders['Content-Type'] = params.contentType;
        if (params.cacheControl) outHeaders['Cache-Control'] = params.cacheControl;

        return { url: fullUrl, headers: outHeaders };
    }

    /**
     * Generates a short-lived AWS SigV4 Presigned GET URL for a private Cloudflare R2 object.
     */
    createR2PresignedGetUrl(
        key: string,
        ttlSeconds?: number,
        now = new Date(),
    ): SignedUrlResult {
        const cfg = this.getConfig();
        if (!cfg.enabled) {
            throw new Error('Cloudflare R2 is not configured');
        }
        const cleanKey = this.sanitizeObjectKey(key);
        if (!cleanKey) {
            throw new BadRequestException('Chave de arquivo inválida.');
        }

        const ttl = Math.min(3600, Math.max(60, Math.floor(ttlSeconds || cfg.presignTtlSeconds)));
        const encodedKey = encodeObjectKeyPath(cleanKey);
        const canonicalUri = `/${rfc3986Encode(cfg.privateBucket)}/${encodedKey}`;
        const endpointUrl = new URL(cfg.endpoint);
        const host = endpointUrl.host;
        const { amzDate, dateStamp } = formatAmzDates(now);
        const credentialScope = `${dateStamp}/auto/s3/aws4_request`;

        const queryParams: Array<[string, string]> = [
            ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
            ['X-Amz-Credential', `${cfg.accessKeyId}/${credentialScope}`],
            ['X-Amz-Date', amzDate],
            ['X-Amz-Expires', String(ttl)],
            ['X-Amz-SignedHeaders', 'host'],
        ];
        queryParams.sort((a, b) => a[0].localeCompare(b[0]));

        const canonicalQueryString = queryParams
            .map(([k, v]) => `${rfc3986Encode(k)}=${rfc3986Encode(v)}`)
            .join('&');

        const canonicalRequest = [
            'GET',
            canonicalUri,
            canonicalQueryString,
            `host:${host}\n`,
            'host',
            'UNSIGNED-PAYLOAD',
        ].join('\n');

        const stringToSign = [
            'AWS4-HMAC-SHA256',
            amzDate,
            credentialScope,
            sha256Hex(canonicalRequest),
        ].join('\n');

        const signingKey = deriveSigningKey(cfg.secretAccessKey, dateStamp, 'auto', 's3');
        const signature = createHmac('sha256', signingKey)
            .update(stringToSign, 'utf8')
            .digest('hex');

        const signedUrl = `${cfg.endpoint}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
        const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();

        return {
            url: signedUrl,
            key: cleanKey,
            expiresAt,
            ttlSeconds: ttl,
            provider: 'cloudflare-r2',
            signatureAlg: 'AWS4-HMAC-SHA256',
        };
    }

    /**
     * Generates an HMAC-SHA256 expiring signed gateway URL for private files
     * (used as local fallback or direct signed download link).
     */
    createSignedGatewayUrl(key: string, ttlSeconds?: number, now = new Date()): SignedUrlResult {
        const cfg = this.getConfig();
        const cleanKey = this.sanitizeObjectKey(key);
        if (!cleanKey) {
            throw new BadRequestException('Chave de arquivo inválida.');
        }

        const ttl = Math.min(3600, Math.max(60, Math.floor(ttlSeconds || cfg.presignTtlSeconds)));
        const expEpoch = Math.floor(now.getTime() / 1000) + ttl;
        const sig = this.computeGatewaySignature(cleanKey, expEpoch);

        return {
            url: `/api/media/private/${cleanKey}?exp=${expEpoch}&sig=${sig}`,
            key: cleanKey,
            expiresAt: new Date(expEpoch * 1000).toISOString(),
            ttlSeconds: ttl,
            provider: cfg.enabled ? 'cloudflare-r2' : 'local-signed',
            signatureAlg: 'HMAC-SHA256',
        };
    }

    private computeGatewaySignature(key: string, expEpoch: number): string {
        return createHmac('sha256', this.getMediaSigningSecret())
            .update(`media-v1|${key}|${expEpoch}`, 'utf8')
            .digest('base64url');
    }

    verifyGatewaySignature(key: string, expRaw: string | number, sig: string): boolean {
        const cleanKey = this.sanitizeObjectKey(key);
        if (!cleanKey || !sig || typeof sig !== 'string') return false;
        const expEpoch = Number(expRaw);
        if (!Number.isFinite(expEpoch) || expEpoch < Math.floor(Date.now() / 1000)) {
            return false;
        }
        const expected = this.computeGatewaySignature(cleanKey, Math.floor(expEpoch));
        const a = Buffer.from(sig, 'utf8');
        const b = Buffer.from(expected, 'utf8');
        if (a.length !== b.length) return false;
        return timingSafeEqual(a, b);
    }

    /**
     * Creates the optimal short-lived signed access URL for a private object:
     * - When R2 is configured -> direct AWS SigV4 Presigned R2 URL (zero Node egress)
     * - When local fallback -> HMAC-SHA256 signed `/api/media/private/...` URL
     */
    createSignedPrivateAccessUrl(key: string, ttlSeconds?: number): SignedUrlResult {
        if (this.isR2Enabled()) {
            return this.createR2PresignedGetUrl(key, ttlSeconds);
        }
        return this.createSignedGatewayUrl(key, ttlSeconds);
    }

    private async putToR2(
        bucket: string,
        key: string,
        buffer: Buffer,
        contentType: string,
        cacheControl: string,
    ): Promise<void> {
        const { url, headers } = this.buildSigV4Headers({
            method: 'PUT',
            bucket,
            key,
            body: buffer,
            contentType,
            cacheControl,
        });

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);
        try {
            const res = await fetch(url, {
                method: 'PUT',
                headers,
                body: new Uint8Array(buffer),
                signal: controller.signal,
            });
            if (!res.ok) {
                const bodyText = await res.text().catch(() => '');
                throw new Error(`R2 PUT failed (${res.status}): ${bodyText.slice(0, 200)}`);
            }
        } finally {
            clearTimeout(timer);
        }
    }

    private async deleteFromR2(bucket: string, key: string): Promise<boolean> {
        const { url, headers } = this.buildSigV4Headers({
            method: 'DELETE',
            bucket,
            key,
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        try {
            const res = await fetch(url, {
                method: 'DELETE',
                headers,
                signal: controller.signal,
            });
            return res.ok || res.status === 404;
        } catch (err: any) {
            this.logger.warn(`R2 DELETE warning (${bucket}/${key}): ${err?.message || err}`);
            return false;
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Checks bucket reachability & SigV4 credentials via S3 HeadBucket (`HEAD /<bucket>`).
     */
    async headBucketInR2(bucket: string): Promise<{ ok: boolean; status: number; detail?: string }> {
        const { url, headers } = this.buildSigV4Headers({
            method: 'HEAD',
            bucket,
            key: '',
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        try {
            const res = await fetch(url, {
                method: 'HEAD',
                headers,
                signal: controller.signal,
            });
            if (res.ok) {
                return { ok: true, status: res.status };
            }
            return {
                ok: false,
                status: res.status,
                detail: res.statusText || `HTTP ${res.status}`,
            };
        } catch (err: any) {
            return {
                ok: false,
                status: 0,
                detail: err?.message || String(err),
            };
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Verifies both public and private Cloudflare R2 buckets are reachable with current credentials.
     */
    async verifyR2Connection(): Promise<{
        ok: boolean;
        publicBucket: { name: string; ok: boolean; status: number; detail?: string };
        privateBucket: { name: string; ok: boolean; status: number; detail?: string };
    }> {
        const cfg = this.getConfig();
        if (!cfg.enabled) {
            const err = { ok: false, status: 0, detail: 'Cloudflare R2 credentials not configured' };
            return {
                ok: false,
                publicBucket: { name: cfg.publicBucket, ...err },
                privateBucket: { name: cfg.privateBucket, ...err },
            };
        }
        const pubCheck = await this.headBucketInR2(cfg.publicBucket);
        const privCheck =
            cfg.privateBucket === cfg.publicBucket
                ? pubCheck
                : await this.headBucketInR2(cfg.privateBucket);

        return {
            ok: pubCheck.ok && privCheck.ok,
            publicBucket: { name: cfg.publicBucket, ...pubCheck },
            privateBucket: { name: cfg.privateBucket, ...privCheck },
        };
    }

    /**
     * Checks whether a specific object key already exists in Cloudflare R2 (for idempotent syncs).
     */
    async objectExistsInR2(visibility: 'public' | 'private', key: string): Promise<boolean> {
        const cfg = this.getConfig();
        if (!cfg.enabled) {
            throw new Error('Cloudflare R2 is not configured');
        }
        const cleanKey = this.sanitizeObjectKey(key);
        if (!cleanKey) return false;

        const bucket = visibility === 'public' ? cfg.publicBucket : cfg.privateBucket;
        const { url, headers } = this.buildSigV4Headers({
            method: 'HEAD',
            bucket,
            key: cleanKey,
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        try {
            const res = await fetch(url, {
                method: 'HEAD',
                headers,
                signal: controller.signal,
            });
            if (res.ok) return true;
            if (res.status === 404) return false;
            throw new Error(`R2 HEAD failed (${res.status}) for ${bucket}/${cleanKey}`);
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Strictly uploads an object directly to Cloudflare R2 at an explicit key without falling back to local disk.
     * Intended for migration / backfill jobs where silent local fallback must never happen.
     */
    async uploadRawObjectToR2(params: {
        visibility: 'public' | 'private';
        key: string;
        buffer: Buffer;
        contentType: string;
        cacheControl?: string;
    }): Promise<StoredObjectResult> {
        const cfg = this.getConfig();
        if (!cfg.enabled) {
            throw new Error('Cloudflare R2 is not configured');
        }
        if (params.visibility === 'public' && !cfg.publicBaseUrl) {
            throw new Error('R2_PUBLIC_URL is required for public Cloudflare R2 uploads');
        }

        const cleanKey = this.sanitizeObjectKey(params.key);
        if (!cleanKey) {
            throw new BadRequestException(`Chave de objeto R2 inválida: ${params.key}`);
        }

        const bucket = params.visibility === 'public' ? cfg.publicBucket : cfg.privateBucket;
        const cacheControl =
            params.cacheControl ||
            (params.visibility === 'public'
                ? 'public, max-age=31536000, immutable'
                : 'private, max-age=300');

        await this.putToR2(bucket, cleanKey, params.buffer, params.contentType, cacheControl);

        return {
            url:
                params.visibility === 'public'
                    ? `${cfg.publicBaseUrl}/${cleanKey}`
                    : `/api/media/private/${cleanKey}`,
            key: cleanKey,
            provider: 'cloudflare-r2',
            visibility: params.visibility,
            contentType: params.contentType,
            sizeBytes: params.buffer.length,
            sha256: sha256Hex(params.buffer),
        };
    }

    /**
     * Uploads a PUBLIC asset (avatars, community network images) with an anonymized UUID filename.
     * Never exposes userId in filenames or public URLs.
     */
    async uploadPublicObject(params: {
        folder: 'avatars' | 'network';
        buffer: Buffer;
        ext: string;
        contentType?: string;
    }): Promise<StoredObjectResult> {
        const safeExt = normalizeSafeExtension(params.ext, 'png');
        const contentType = params.contentType || resolveMimeForExtension(safeExt);
        const filename = `${randomUUID()}.${safeExt}`;
        const key = `${params.folder}/${filename}`;
        const digest = sha256Hex(params.buffer);
        const cfg = this.getConfig();

        if (cfg.enabled && cfg.publicBaseUrl) {
            try {
                await this.putToR2(
                    cfg.publicBucket,
                    key,
                    params.buffer,
                    contentType,
                    'public, max-age=31536000, immutable',
                );
                return {
                    url: `${cfg.publicBaseUrl}/${key}`,
                    key,
                    provider: 'cloudflare-r2',
                    visibility: 'public',
                    contentType,
                    sizeBytes: params.buffer.length,
                    sha256: digest,
                };
            } catch (err: any) {
                this.logger.error(
                    `Cloudflare R2 public upload failed for ${key}; falling back to local disk: ${err?.message || err}`,
                );
            }
        }

        const targetDir = path.join(process.cwd(), 'uploads', params.folder);
        await fs.promises.mkdir(targetDir, { recursive: true });
        await fs.promises.writeFile(path.join(targetDir, filename), params.buffer);

        return {
            url: `/uploads/${params.folder}/${filename}`,
            key,
            provider: 'local-signed',
            visibility: 'public',
            contentType,
            sizeBytes: params.buffer.length,
            sha256: digest,
        };
    }

    /**
     * Uploads a PRIVATE user asset (journal screenshots, mental-log images, backtest screenshots).
     * Stored in R2 private bucket (or `./private-uploads` outside public `/uploads/` when local).
     * Returns a stable gateway URL `/api/media/private/<key>` which enforces ownership / signature
     * and redirects to a 5-min R2 SigV4 Presigned URL when R2 is active.
     */
    async uploadPrivateObject(params: {
        userId: string;
        folder: 'journal-screenshots' | 'backtest-screenshots' | 'mental-logs' | 'reports';
        buffer: Buffer;
        ext: string;
        contentType?: string;
    }): Promise<StoredObjectResult> {
        const safeExt = normalizeSafeExtension(params.ext, 'png');
        const contentType = params.contentType || resolveMimeForExtension(safeExt);
        const ownerTag = this.computeOwnerTag(params.userId);
        const filename = `${randomUUID()}.${safeExt}`;
        const key = `private/${ownerTag}/${params.folder}/${filename}`;
        const digest = sha256Hex(params.buffer);
        const cfg = this.getConfig();

        if (cfg.enabled) {
            try {
                await this.putToR2(
                    cfg.privateBucket,
                    key,
                    params.buffer,
                    contentType,
                    'private, max-age=300',
                );
                return {
                    url: `/api/media/private/${key}`,
                    key,
                    provider: 'cloudflare-r2',
                    visibility: 'private',
                    contentType,
                    sizeBytes: params.buffer.length,
                    sha256: digest,
                };
            } catch (err: any) {
                this.logger.error(
                    `Cloudflare R2 private upload failed for ${key}; falling back to private-uploads disk: ${err?.message || err}`,
                );
            }
        }

        const localPath = this.resolveLocalPrivatePath(key);
        await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
        await fs.promises.writeFile(localPath, params.buffer);

        return {
            url: `/api/media/private/${key}`,
            key,
            provider: 'local-signed',
            visibility: 'private',
            contentType,
            sizeBytes: params.buffer.length,
            sha256: digest,
        };
    }

    resolveLocalPrivatePath(key: string): string {
        const cleanKey = this.sanitizeObjectKey(key);
        if (!cleanKey) {
            throw new BadRequestException('Chave de arquivo inválida.');
        }
        const rootDir = path.resolve(process.cwd(), 'private-uploads');
        const resolved = path.resolve(rootDir, cleanKey);
        if (!resolved.startsWith(rootDir + path.sep) && resolved !== rootDir) {
            throw new BadRequestException('Caminho de arquivo inválido.');
        }
        return resolved;
    }

    /**
     * Deletes a public or private asset from R2 and/or local disk safely.
     */
    async deleteByUrl(rawUrl?: string | null, ownerUserId?: string): Promise<boolean> {
        if (!rawUrl || typeof rawUrl !== 'string') return false;
        const cleanUrl = rawUrl.split('?')[0].trim();
        const cfg = this.getConfig();

        // 1. Private gateway URL: /api/media/private/private/<ownerTag>/<folder>/<file>
        const privatePrefix = '/api/media/private/';
        if (cleanUrl.startsWith(privatePrefix)) {
            const key = this.sanitizeObjectKey(cleanUrl.slice(privatePrefix.length));
            if (!key) return false;
            if (ownerUserId && !this.isPrivateKeyOwnedByUser(key, ownerUserId)) {
                return false;
            }
            let deleted = false;
            if (cfg.enabled) {
                deleted = await this.deleteFromR2(cfg.privateBucket, key);
            }
            try {
                const localPath = this.resolveLocalPrivatePath(key);
                await fs.promises.unlink(localPath);
                deleted = true;
            } catch {
                // Not on local disk
            }
            return deleted;
        }

        // 2. Public R2 URL: ${R2_PUBLIC_URL}/avatars/... or /network/...
        if (cfg.enabled && cfg.publicBaseUrl && cleanUrl.startsWith(`${cfg.publicBaseUrl}/`)) {
            const key = this.sanitizeObjectKey(cleanUrl.slice(cfg.publicBaseUrl.length + 1));
            if (!key) return false;
            return this.deleteFromR2(cfg.publicBucket, key);
        }

        // 3. Legacy local /uploads/... path
        if (cleanUrl.startsWith('/uploads/')) {
            const rel = this.sanitizeObjectKey(cleanUrl.slice('/uploads/'.length));
            if (!rel) return false;
            const uploadsRoot = path.resolve(process.cwd(), 'uploads');
            const targetPath = path.resolve(uploadsRoot, rel);
            if (!targetPath.startsWith(uploadsRoot + path.sep)) return false;
            try {
                await fs.promises.unlink(targetPath);
                return true;
            } catch {
                return false;
            }
        }

        return false;
    }
}
