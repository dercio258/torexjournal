import {
    BadRequestException,
    Controller,
    ForbiddenException,
    Get,
    NotFoundException,
    Query,
    Req,
    Res,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { FastifyReply } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import { extractUserAccessToken } from './cookie-security.util';
import {
    CloudflareR2StorageService,
    resolveMimeForExtension,
} from './cloudflare-r2-storage.service';
import { RedisSecurityService } from './redis-security.service';
import { getJwtSecret } from './security.config';

@Controller('media')
export class MediaController {
    constructor(
        private readonly r2Storage: CloudflareR2StorageService,
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        private readonly redisSecurity: RedisSecurityService,
    ) {}

    /**
     * Self-contained JWT verification (HttpOnly cookie or Bearer header) with Phase P2
     * revocation enforcement (`revoked_jti` + `user_revoked_after`), avoiding circular
     * imports between `@Global() SecurityModule` and `UsersModule`.
     */
    private async resolveAuthenticatedUserId(req: any): Promise<string | null> {
        const token = extractUserAccessToken(req);
        if (!token) return null;

        try {
            const payload: any = this.jwtService.verify(token, {
                secret: getJwtSecret(this.configService),
            });
            const userId = String(payload?.sub || payload?.id || '').trim();
            if (!userId) return null;

            if (payload?.jti) {
                const revokedJti = await this.redisSecurity.getValue(
                    `revoked_jti:${String(payload.jti)}`,
                );
                if (revokedJti) return null;
            }

            const revokedAfterRaw = await this.redisSecurity.getValue(
                `user_revoked_after:${userId}`,
            );
            if (revokedAfterRaw) {
                const revokedAfterMs = Number(revokedAfterRaw);
                const iatMs = Number(payload?.iat || 0) * 1000;
                if (Number.isFinite(revokedAfterMs) && iatMs > 0 && iatMs < revokedAfterMs) {
                    return null;
                }
            }

            return userId;
        } catch {
            return null;
        }
    }

    /**
     * Issues a short-lived digitally signed URL (Cloudflare R2 AWS SigV4 Presigned GET URL
     * or HMAC-SHA256 signed local gateway URL) for a private user-owned asset.
     */
    @Get('signed-url')
    @Throttle({ default: { limit: 120, ttl: 60000 } })
    async getSignedPrivateUrl(
        @Req() req: any,
        @Query('key') rawKey?: string,
        @Query('ttl') rawTtl?: string,
    ) {
        const userId = await this.resolveAuthenticatedUserId(req);
        if (!userId) {
            throw new UnauthorizedException('Autenticação necessária.');
        }

        let cleanKey = String(rawKey || '').trim();
        if (cleanKey.startsWith('/api/media/private/')) {
            cleanKey = cleanKey.slice('/api/media/private/'.length).split('?')[0];
        }
        const safeKey = this.r2Storage.sanitizeObjectKey(cleanKey);
        if (!safeKey) {
            throw new BadRequestException('Referência de arquivo inválida.');
        }
        if (!this.r2Storage.isPrivateKeyOwnedByUser(safeKey, userId)) {
            throw new ForbiddenException('Acesso negado a este arquivo privado.');
        }

        const parsedTtl = rawTtl ? Number(rawTtl) : undefined;
        return this.r2Storage.createSignedPrivateAccessUrl(safeKey, parsedTtl);
    }

    /**
     * Private media gateway (`/api/media/private/*`).
     * Authorizes access via EITHER:
     *   1) Valid expiring HMAC-SHA256 digital signature (`?exp=...&sig=...`), OR
     *   2) Authenticated user session (HttpOnly cookie `__Host-torex_at` or `Authorization: Bearer`)
     *      matching the object's opaque owner tag (zero IDOR).
     *
     * When Cloudflare R2 is active, responds with a 302 redirect to a freshly minted
     * 5-minute AWS SigV4 Presigned R2 URL (zero media egress through Node.js).
     * When running with local fallback, streams from `./private-uploads/` with sandboxed CSP headers.
     */
    @Get('private/*')
    @Throttle({ default: { limit: 240, ttl: 60000 } })
    async servePrivateMedia(
        @Req() req: any,
        @Res() reply: FastifyReply,
        @Query('exp') exp?: string,
        @Query('sig') sig?: string,
    ) {
        const rawUrl = String(req?.url || '').split('?')[0];
        const prefix = '/api/media/private/';
        const idx = rawUrl.indexOf(prefix);
        const extracted = idx >= 0 ? decodeURIComponent(rawUrl.slice(idx + prefix.length)) : '';
        const safeKey = this.r2Storage.sanitizeObjectKey(extracted);
        if (!safeKey || !safeKey.startsWith('private/')) {
            throw new BadRequestException('Chave de mídia privada inválida.');
        }

        let authorized = false;

        // Path A: Valid expiring HMAC-SHA256 digital signature
        if (exp && sig && this.r2Storage.verifyGatewaySignature(safeKey, exp, sig)) {
            authorized = true;
        }

        // Path B: Authenticated user owning this private partition (HttpOnly cookie or Bearer JWT)
        if (!authorized) {
            const userId = await this.resolveAuthenticatedUserId(req);
            if (userId && this.r2Storage.isPrivateKeyOwnedByUser(safeKey, userId)) {
                authorized = true;
            }
        }

        if (!authorized) {
            throw new ForbiddenException('Assinatura inválida, expirada ou acesso não autorizado.');
        }

        // If Cloudflare R2 is configured, redirect directly to a short-lived SigV4 Presigned URL
        if (this.r2Storage.isR2Enabled()) {
            const signed = this.r2Storage.createR2PresignedGetUrl(safeKey);
            reply.header('Cache-Control', 'private, no-store, max-age=0');
            reply.header('X-Torex-Media-Provider', 'cloudflare-r2');
            return reply.code(302).redirect(signed.url);
        }

        // Local private fallback: stream from ./private-uploads with strict sandbox headers
        const localPath = this.r2Storage.resolveLocalPrivatePath(safeKey);
        if (!fs.existsSync(localPath)) {
            throw new NotFoundException('Arquivo não encontrado.');
        }

        const ext = path.extname(localPath).replace(/^\./, '').toLowerCase() || 'png';
        const contentType = resolveMimeForExtension(ext);
        const fileBuffer = await fs.promises.readFile(localPath);

        reply.header('Content-Type', contentType);
        reply.header('Content-Length', String(fileBuffer.length));
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
        reply.header('Cross-Origin-Resource-Policy', 'same-site');
        reply.header('Cache-Control', 'private, max-age=300');
        reply.header('X-Torex-Media-Provider', 'local-signed');
        return reply.send(fileBuffer);
    }
}
